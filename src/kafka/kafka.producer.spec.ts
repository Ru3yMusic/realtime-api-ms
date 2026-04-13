import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KafkaProducerService } from './kafka.producer';
import { SchemaRegistryService } from '../schema-registry/schema-registry.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal KafkaJS message shape for DLQ tests */
function makeMessage(overrides: Partial<{
  key: Buffer | null;
  partition: number;
  offset: string;
  value: Buffer | null;
}> = {}) {
  return {
    key:       Buffer.from('msg-key'),
    partition: 0,
    offset:    '42',
    value:     Buffer.from('raw-avro-payload'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('KafkaProducerService — publishToDlq', () => {
  let service: KafkaProducerService;
  let mockSend: jest.Mock;

  beforeEach(async () => {
    mockSend = jest.fn().mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaProducerService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('localhost:9092') } },
        { provide: SchemaRegistryService, useValue: {} },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<KafkaProducerService>(KafkaProducerService);

    // Bypass onModuleInit — inject a mock KafkaJS producer directly
    (service as any).producer = { send: mockSend };
  });

  afterEach(() => jest.clearAllMocks());

  // ── Success path ───────────────────────────────────────────────────────────

  it('sends to {topic}.dlq with structured metadata when called', async () => {
    const originalTopic = 'realtime.comment.created';
    const message       = makeMessage({ partition: 2, offset: '99' });
    const error         = new Error('avro decode failure');

    await service.publishToDlq(originalTopic, message, error);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const callArg = mockSend.mock.calls[0][0];

    // Correct DLQ topic
    expect(callArg.topic).toBe('realtime.comment.created.dlq');

    // Structured payload
    const payload = JSON.parse(callArg.messages[0].value);
    expect(payload.originalTopic).toBe(originalTopic);
    expect(payload.originalPartition).toBe(2);
    expect(payload.originalOffset).toBe('99');
    expect(payload.error).toBe('avro decode failure');
    expect(payload.rawPayload).toBe(message.value.toString('base64'));
    expect(payload.timestamp).toBeDefined();

    // Headers
    const headers = callArg.messages[0].headers;
    expect(headers['dlq.error']).toBe('avro decode failure');
    expect(headers['dlq.original-topic']).toBe(originalTopic);
  });

  it('uses message.key as the DLQ message key', async () => {
    const message = makeMessage({ key: Buffer.from('user-123') });

    await service.publishToDlq('realtime.comment.liked', message, new Error('err'));

    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.messages[0].key).toBe('user-123');
  });

  it('handles null key and null value gracefully', async () => {
    const message = makeMessage({ key: null, value: null });

    await expect(
      service.publishToDlq('realtime.comment.created', message, new Error('err')),
    ).resolves.toBeUndefined();

    const payload = JSON.parse(mockSend.mock.calls[0][0].messages[0].value);
    expect(payload.rawPayload).toBeUndefined(); // null?.toString('base64') → undefined
  });

  // ── DLQ publish failure ────────────────────────────────────────────────────

  it('does NOT throw when the DLQ send itself fails (swallows to avoid infinite loop)', async () => {
    mockSend.mockRejectedValue(new Error('Kafka broker unavailable'));

    await expect(
      service.publishToDlq('realtime.comment.created', makeMessage(), new Error('original')),
    ).resolves.toBeUndefined();
  });

  it('does NOT attempt to re-publish to DLQ when DLQ send fails', async () => {
    mockSend.mockRejectedValue(new Error('broker down'));

    await service.publishToDlq('realtime.comment.created', makeMessage(), new Error('original'));

    // producer.send was called exactly once — no retry loop
    expect(mockSend).toHaveBeenCalledTimes(1);
  });
});

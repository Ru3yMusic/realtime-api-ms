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

  // ── publishNotificationPush ───────────────────────────────────────────────

  it('publishNotificationPush encodes payload and sends to NOTIFICATION_PUSH topic', async () => {
    const schemaRegistry = (service as any).schemaRegistry = {
      encode: jest.fn().mockReturnValue(Buffer.from('avro-bytes')),
    };

    const event = {
      notification_id: 'n1',
      recipient_id: 'u-1',
      actor_id: 'u-2',
      actor_username: 'bob',
      actor_photo_url: null,
      type: 'FRIEND_REQUEST',
      target_id: 'f-1',
      target_type: 'USER',
      timestamp: 0,
    };

    await service.publishNotificationPush(event as any);

    expect(schemaRegistry.encode).toHaveBeenCalledWith('realtime.notification.push', event);
    expect(mockSend).toHaveBeenCalledWith({
      topic: 'realtime.notification.push',
      messages: [{ key: 'u-1', value: Buffer.from('avro-bytes') }],
    });
  });

  it('publishNotificationPush swallows encode errors and does NOT throw', async () => {
    (service as any).schemaRegistry = {
      encode: jest.fn().mockImplementation(() => { throw new Error('encode boom'); }),
    };

    await expect(service.publishNotificationPush({
      recipient_id: 'u-1', type: 'FRIEND_REQUEST',
    } as any)).resolves.toBeUndefined();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('publishNotificationPush swallows producer.send errors and does NOT throw', async () => {
    (service as any).schemaRegistry = {
      encode: jest.fn().mockReturnValue(Buffer.from('payload')),
    };
    mockSend.mockRejectedValue(new Error('broker down'));

    await expect(service.publishNotificationPush({
      recipient_id: 'u-1', type: 'FRIEND_REQUEST',
    } as any)).resolves.toBeUndefined();
  });

  // ── onModuleDestroy ───────────────────────────────────────────────────────

  it('onModuleDestroy disconnects the producer', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    (service as any).producer = { disconnect };

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalled();
  });
});

// ===========================================================================
// onModuleInit — Kafka producer construction with mocked kafkajs
// ===========================================================================

const mockProducer = {
  connect:    jest.fn().mockResolvedValue(undefined),
  send:       jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
};

const mockKafkaCtor = jest.fn().mockImplementation(() => ({
  producer: jest.fn().mockReturnValue(mockProducer),
}));

jest.mock('kafkajs', () => ({
  Kafka: function Kafka(config: unknown) { return mockKafkaCtor(config); },
}));

describe('KafkaProducerService — onModuleInit', () => {
  const configValues: Record<string, string> = {
    'kafka.broker': 'localhost:9092',
    'kafka.securityProtocol': 'PLAINTEXT',
    'kafka.apiKey': 'k',
    'kafka.apiSecret': 's',
  };

  const config = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  let service: KafkaProducerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KafkaProducerService(config, {} as any);
  });

  it('connects with PLAINTEXT (no SASL) when securityProtocol is PLAINTEXT', async () => {
    configValues['kafka.securityProtocol'] = 'PLAINTEXT';

    await service.onModuleInit();

    expect(mockKafkaCtor).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'realtime-api-ms-producer',
      brokers: ['localhost:9092'],
    }));
    const call = mockKafkaCtor.mock.calls[0][0];
    expect(call).not.toHaveProperty('ssl');
    expect(call).not.toHaveProperty('sasl');
    expect(mockProducer.connect).toHaveBeenCalled();
  });

  it('adds SASL config when securityProtocol is SASL_SSL', async () => {
    configValues['kafka.securityProtocol'] = 'SASL_SSL';

    await service.onModuleInit();

    expect(mockKafkaCtor).toHaveBeenCalledWith(expect.objectContaining({
      ssl: true,
      sasl: { mechanism: 'plain', username: 'k', password: 's' },
    }));
  });
});

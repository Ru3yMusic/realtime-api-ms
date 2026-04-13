import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { KafkaConsumerService } from './kafka.consumer';
import { SchemaRegistryService } from '../schema-registry/schema-registry.service';
import { KafkaStreamsService } from './kafka-streams.service';
import { KafkaProducerService } from './kafka.producer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal EachMessagePayload for handleAvro tests */
function makeAvroPayload(overrides: Record<string, unknown> = {}) {
  return {
    topic:     'realtime.comment.created',
    partition: 0,
    message: {
      offset:    '42',
      key:       Buffer.from('user-123'),
      value:     Buffer.from('raw-avro'),
      timestamp: '1700000000000',
      headers:   {},
      size:      8,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('KafkaConsumerService — DLQ delegation', () => {
  let consumer: KafkaConsumerService;
  let mockProducer: { publishToDlq: jest.Mock };
  let mockSchemaRegistry: { decode: jest.Mock };
  let mockStreams: { dispatch: jest.Mock };

  beforeEach(async () => {
    mockProducer       = { publishToDlq: jest.fn().mockResolvedValue(undefined) };
    mockSchemaRegistry = { decode: jest.fn() };
    mockStreams         = { dispatch: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KafkaConsumerService,
        { provide: ConfigService,         useValue: { get: jest.fn().mockReturnValue('test-group') } },
        { provide: SchemaRegistryService, useValue: mockSchemaRegistry },
        { provide: KafkaStreamsService,   useValue: mockStreams },
        { provide: KafkaProducerService,  useValue: mockProducer },
      ],
    }).compile();

    module.useLogger(false);
    consumer = module.get<KafkaConsumerService>(KafkaConsumerService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── DLQ called on Avro decode failure ─────────────────────────────────────

  it('calls producer.publishToDlq when schemaRegistry.decode throws', async () => {
    const decodeError = new Error('invalid avro magic byte');
    mockSchemaRegistry.decode.mockImplementation(() => { throw decodeError; });

    const payload = makeAvroPayload();
    await (consumer as any).handleAvro(payload);

    expect(mockProducer.publishToDlq).toHaveBeenCalledTimes(1);
    expect(mockProducer.publishToDlq).toHaveBeenCalledWith(
      'realtime.comment.created',
      payload.message,
      decodeError,
    );
  });

  it('passes the full message object (not just message.value) to publishToDlq', async () => {
    mockSchemaRegistry.decode.mockImplementation(() => { throw new Error('err'); });

    const payload = makeAvroPayload({ partition: 3 });
    await (consumer as any).handleAvro(payload);

    const [, passedMessage] = mockProducer.publishToDlq.mock.calls[0];
    // Full message — has offset, key, value (not just a Buffer)
    expect(passedMessage).toHaveProperty('offset', '42');
    expect(passedMessage).toHaveProperty('key');
    expect(passedMessage).toHaveProperty('value');
  });

  // ── Normal path — DLQ not called ──────────────────────────────────────────

  it('does NOT call publishToDlq when Avro decode succeeds', async () => {
    mockSchemaRegistry.decode.mockReturnValue({ comment_id: 'c-1', content: 'hello' });

    await (consumer as any).handleAvro(makeAvroPayload());

    expect(mockProducer.publishToDlq).not.toHaveBeenCalled();
    expect(mockStreams.dispatch).toHaveBeenCalledTimes(1);
  });

  // ── Null message value — early return ─────────────────────────────────────

  it('returns early without calling decode or DLQ when message.value is null', async () => {
    const payload = makeAvroPayload();
    payload.message.value = null as any;

    await (consumer as any).handleAvro(payload);

    expect(mockSchemaRegistry.decode).not.toHaveBeenCalled();
    expect(mockProducer.publishToDlq).not.toHaveBeenCalled();
  });
});

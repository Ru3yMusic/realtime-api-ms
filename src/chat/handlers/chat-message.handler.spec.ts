import { Subject } from 'rxjs';
import { ChatMessageHandler } from './chat-message.handler';
import { KafkaStreamsService, KafkaStreamMessage } from '../../kafka/kafka-streams.service';
import { ChatService } from '../chat.service';
import { ChatMessageEvent, TOPICS } from '../../common/types/avro-events.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeChatMessageEvent(overrides: Partial<ChatMessageEvent> = {}): ChatMessageEvent {
  return {
    message_id:        'msg-uuid-1',
    station_id:        'station-1',
    user_id:           'user-1',
    username:          'alice',
    profile_photo_url: null,
    content:           'Hello station!',
    mentions:          [],
    timestamp:         '2026-04-12T00:00:00Z',
    ...overrides,
  };
}

function makeStreamMessage(value: ChatMessageEvent): KafkaStreamMessage<ChatMessageEvent> {
  return {
    topic:     TOPICS.CHAT_MESSAGE,
    partition: 0,
    offset:    '0',
    key:       null,
    value,
    timestamp: '0',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChatMessageHandler', () => {
  let handler: ChatMessageHandler;
  let subject$: Subject<KafkaStreamMessage<ChatMessageEvent>>;

  let chatService: jest.Mocked<Pick<ChatService, 'saveMessage'>>;
  let streamsService: jest.Mocked<Pick<KafkaStreamsService, 'stream'>>;

  beforeEach(() => {
    subject$ = new Subject();

    chatService = {
      saveMessage: jest.fn().mockResolvedValue({}),
    };
    streamsService = {
      stream: jest.fn().mockReturnValue(subject$.asObservable()),
    };

    handler = new ChatMessageHandler(
      streamsService as any,
      chatService as any,
    );

    handler.onModuleInit();
  });

  afterEach(() => jest.clearAllMocks());

  // ── Persistence ───────────────────────────────────────────────────────────

  it('saves message to MongoDB on Kafka event', async () => {
    const event = makeChatMessageEvent();
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    expect(chatService.saveMessage).toHaveBeenCalledWith({
      message_id:        'msg-uuid-1',
      station_id:        'station-1',
      user_id:           'user-1',
      username:          'alice',
      profile_photo_url: null,
      content:           'Hello station!',
      mentions:          [],
    });
  });

  it('handles profile_photo_url correctly when provided', async () => {
    const event = makeChatMessageEvent({ profile_photo_url: 'https://cdn/avatar.jpg' });
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    expect(chatService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ profile_photo_url: 'https://cdn/avatar.jpg' }),
    );
  });

  it('handles mentions array correctly', async () => {
    const event = makeChatMessageEvent({ mentions: ['user-2', 'user-3'] });
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    expect(chatService.saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mentions: ['user-2', 'user-3'] }),
    );
  });

  // ── Duplicate handling ────────────────────────────────────────────────────

  it('calls saveMessage for each event (idempotency enforced by service/DB unique index)', async () => {
    const event = makeChatMessageEvent();

    // Simulate same message replayed twice
    subject$.next(makeStreamMessage(event));
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    // Handler calls saveMessage both times; MongoDB deduplicates via unique index + $setOnInsert
    expect(chatService.saveMessage).toHaveBeenCalledTimes(2);
  });

  // ── Error resilience ──────────────────────────────────────────────────────

  it('continues processing after a failed message', async () => {
    chatService.saveMessage
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({} as any);

    const event1 = makeChatMessageEvent({ message_id: 'fail-msg' });
    const event2 = makeChatMessageEvent({ message_id: 'ok-msg' });

    subject$.next(makeStreamMessage(event1));
    subject$.next(makeStreamMessage(event2));

    await new Promise((r) => setTimeout(r, 0));

    // Stream survives the error — second message is processed
    expect(chatService.saveMessage).toHaveBeenCalledTimes(2);
    expect(chatService.saveMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ message_id: 'ok-msg' }),
    );
  });

  it('subscribes to the correct Kafka topic', () => {
    expect(streamsService.stream).toHaveBeenCalledWith(TOPICS.CHAT_MESSAGE);
    expect(streamsService.stream).toHaveBeenCalledWith('realtime.chat.message');
  });
});

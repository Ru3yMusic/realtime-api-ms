import { Subject } from 'rxjs';
import { CommentCreatedHandler } from './comment-created.handler';
import { KafkaStreamsService, KafkaStreamMessage } from '../../kafka/kafka-streams.service';
import { KafkaProducerService } from '../../kafka/kafka.producer';
import { CommentsService } from '../comments.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { CommentCreatedEvent, NotificationEventType, TOPICS } from '../../common/types/avro-events.types';

function makeEvent(overrides: Partial<CommentCreatedEvent> = {}): CommentCreatedEvent {
  return {
    comment_id: 'comment-1',
    song_id: 'song-1',
    station_id: 'station-1',
    user_id: 'author-1',
    username: 'alice',
    profile_photo_url: null,
    content: 'hello @bob',
    mentions: ['user-2'],
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function makeStreamMessage(value: CommentCreatedEvent): KafkaStreamMessage<CommentCreatedEvent> {
  return {
    topic: TOPICS.COMMENT_CREATED,
    partition: 0,
    offset: '0',
    key: null,
    value,
    timestamp: '0',
  };
}

describe('CommentCreatedHandler', () => {
  let handler: CommentCreatedHandler;
  let subject$: Subject<KafkaStreamMessage<CommentCreatedEvent>>;

  let commentsService: jest.Mocked<Pick<CommentsService, 'persistFromEvent'>>;
  let producer: jest.Mocked<Pick<KafkaProducerService, 'publishNotificationPush'>>;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'create' | 'incrementBadges'>>;
  let streams: jest.Mocked<Pick<KafkaStreamsService, 'stream'>>;

  beforeEach(() => {
    subject$ = new Subject();

    commentsService = {
      persistFromEvent: jest.fn().mockResolvedValue(undefined as any),
    };
    producer = {
      publishNotificationPush: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      create: jest.fn().mockResolvedValue({ _id: { toString: () => 'notif-1' } } as any),
      incrementBadges: jest.fn().mockResolvedValue(undefined),
    };
    streams = {
      stream: jest.fn().mockReturnValue(subject$.asObservable()),
    };

    handler = new CommentCreatedHandler(
      streams as any,
      commentsService as any,
      producer as any,
      notificationsService as any,
    );

    handler.onModuleInit();
  });

  afterEach(() => jest.clearAllMocks());

  it('subscribes to comment.created topic', () => {
    expect(streams.stream).toHaveBeenCalledWith(TOPICS.COMMENT_CREATED);
  });

  it('persists comment and emits mention notifications', async () => {
    const event = makeEvent({ mentions: ['user-2', 'user-3'] });
    subject$.next(makeStreamMessage(event));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commentsService.persistFromEvent).toHaveBeenCalledWith(event);
    expect(notificationsService.create).toHaveBeenCalledTimes(2);
    expect(notificationsService.incrementBadges).toHaveBeenCalledWith('user-2', { notification: true });
    expect(notificationsService.incrementBadges).toHaveBeenCalledWith('user-3', { notification: true });
    expect(producer.publishNotificationPush).toHaveBeenCalledTimes(2);
    expect(producer.publishNotificationPush).toHaveBeenCalledWith(
      expect.objectContaining({
        notification_id: 'notif-1',
        recipient_id: 'user-2',
        type: NotificationEventType.MENTION,
        target_id: 'comment-1',
      }),
    );
  });

  it('skips self-mentions', async () => {
    const event = makeEvent({ mentions: ['author-1', 'user-2'] });
    subject$.next(makeStreamMessage(event));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notificationsService.create).toHaveBeenCalledTimes(1);
    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-2' }),
    );
  });

  it('continues stream when one message fails', async () => {
    const loggerSpy = jest.spyOn((handler as any).logger, 'error').mockImplementation();
    commentsService.persistFromEvent
      .mockRejectedValueOnce(new Error('DB down'))
      .mockResolvedValueOnce(undefined as any);

    subject$.next(makeStreamMessage(makeEvent({ comment_id: 'bad-comment' })));
    subject$.next(makeStreamMessage(makeEvent({ comment_id: 'ok-comment', mentions: [] })));

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(commentsService.persistFromEvent).toHaveBeenCalledTimes(2);
    expect(loggerSpy).toHaveBeenCalledWith(
      'Failed to process comment.created: bad-comment',
      expect.any(Error),
    );
  });

  it('does not notify when mentions are missing', async () => {
    const event = makeEvent({ mentions: undefined as any });

    await (handler as any).handle(event);

    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(notificationsService.incrementBadges).not.toHaveBeenCalled();
    expect(producer.publishNotificationPush).not.toHaveBeenCalled();
  });
});

import { Subject } from 'rxjs';
import { CommentLikedHandler } from './comment-liked.handler';
import { KafkaStreamsService, KafkaStreamMessage } from '../../kafka/kafka-streams.service';
import { CommentsService } from '../comments.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { KafkaProducerService } from '../../kafka/kafka.producer';
import { CommentLikedEvent, NotificationEventType, TOPICS } from '../../common/types/avro-events.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLikedEvent(overrides: Partial<CommentLikedEvent> = {}): CommentLikedEvent {
  return {
    comment_id:        'comment-1',
    comment_author_id: 'author-1',
    liker_id:          'liker-99',
    liker_username:    'alice',
    liker_photo_url:   null,
    song_id:           'song-1',
    station_id:        'station-1',
    timestamp:         1_700_000_000_000,
    action:            'like',
    ...overrides,
  };
}

function makeStreamMessage(value: CommentLikedEvent): KafkaStreamMessage<CommentLikedEvent> {
  return { topic: TOPICS.COMMENT_LIKED, partition: 0, offset: '0', key: null, value, timestamp: '0' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommentLikedHandler', () => {
  let handler: CommentLikedHandler;
  let subject$: Subject<KafkaStreamMessage<CommentLikedEvent>>;

  let commentsService: jest.Mocked<Pick<CommentsService, 'incrementLikes' | 'decrementLikes'>>;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'create' | 'incrementBadges'>>;
  let kafkaProducer: jest.Mocked<Pick<KafkaProducerService, 'publishNotificationPush'>>;
  let streamsService: jest.Mocked<Pick<KafkaStreamsService, 'stream'>>;

  beforeEach(() => {
    subject$ = new Subject();

    commentsService = {
      incrementLikes: jest.fn().mockResolvedValue(undefined),
      decrementLikes: jest.fn().mockResolvedValue(undefined),
    };
    notificationsService = {
      create:           jest.fn().mockResolvedValue(undefined),
      incrementBadges:  jest.fn().mockResolvedValue(undefined),
    };
    kafkaProducer = {
      publishNotificationPush: jest.fn().mockResolvedValue(undefined),
    };
    streamsService = {
      stream: jest.fn().mockReturnValue(subject$.asObservable()),
    };

    handler = new CommentLikedHandler(
      streamsService as any,
      commentsService as any,
      kafkaProducer as any,
      notificationsService as any,
    );

    // Wire up the subscription
    handler.onModuleInit();
  });

  afterEach(() => jest.clearAllMocks());

  // ── action === 'like' ─────────────────────────────────────────────────────

  it('increments likes when action is "like"', async () => {
    const event = makeLikedEvent({ action: 'like' });
    subject$.next(makeStreamMessage(event));

    // Give the async pipe a tick
    await new Promise((r) => setTimeout(r, 0));

    expect(commentsService.incrementLikes).toHaveBeenCalledWith('comment-1', 'liker-99');
    expect(commentsService.decrementLikes).not.toHaveBeenCalled();
  });

  it('creates a notification and publishes to Kafka when action is "like"', async () => {
    const event = makeLikedEvent({ action: 'like', liker_photo_url: 'https://cdn/a.jpg' });
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    expect(notificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id:        'author-1',
        actor_id:       'liker-99',
        actor_username: 'alice',
        type:           NotificationEventType.COMMENT_REACTION,
      }),
    );
    expect(kafkaProducer.publishNotificationPush).toHaveBeenCalled();
  });

  it('does NOT notify on self-like (liker === author)', async () => {
    const event = makeLikedEvent({ action: 'like', liker_id: 'author-1' });
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    expect(commentsService.incrementLikes).toHaveBeenCalled();
    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(kafkaProducer.publishNotificationPush).not.toHaveBeenCalled();
  });

  // ── action === 'unlike' ───────────────────────────────────────────────────

  it('decrements likes when action is "unlike"', async () => {
    const event = makeLikedEvent({ action: 'unlike' });
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    expect(commentsService.decrementLikes).toHaveBeenCalledWith('comment-1', 'liker-99');
    expect(commentsService.incrementLikes).not.toHaveBeenCalled();
  });

  it('does NOT create a notification on unlike', async () => {
    const event = makeLikedEvent({ action: 'unlike' });
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    expect(notificationsService.create).not.toHaveBeenCalled();
    expect(kafkaProducer.publishNotificationPush).not.toHaveBeenCalled();
  });

  // ── Regression: old UNLIKE: prefix must NOT be used ──────────────────────

  it('does NOT treat normal liker_username as unlike (regression: UNLIKE: prefix removed)', async () => {
    // A username that happens to look like the old prefix approach
    const event = makeLikedEvent({ action: 'like', liker_username: 'UnlikeTheOldWay' });
    subject$.next(makeStreamMessage(event));

    await new Promise((r) => setTimeout(r, 0));

    // action='like' must win, not the username string
    expect(commentsService.incrementLikes).toHaveBeenCalled();
    expect(commentsService.decrementLikes).not.toHaveBeenCalled();
  });
});

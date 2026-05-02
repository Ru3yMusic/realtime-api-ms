import { Subject } from 'rxjs';
import { FriendRequestHandler } from './friend-request.handler';
import { NotificationEventType, TOPICS } from '../../common/types/avro-events.types';

describe('FriendRequestHandler', () => {
  let streams: { stream: jest.Mock; subjects: Map<string, Subject<any>> };
  let notificationsService: any;
  let kafkaProducer: any;
  let handler: FriendRequestHandler;
  let topicSubject: Subject<any>;

  beforeEach(() => {
    topicSubject = new Subject<any>();
    streams = {
      stream: jest.fn().mockReturnValue(topicSubject.asObservable()),
      subjects: new Map(),
    };

    notificationsService = {
      create: jest.fn().mockResolvedValue({ _id: { toString: () => 'notif-1' } }),
      incrementBadges: jest.fn().mockResolvedValue(undefined),
    };

    kafkaProducer = {
      publishNotificationPush: jest.fn().mockResolvedValue(undefined),
    };

    handler = new FriendRequestHandler(streams as any, notificationsService, kafkaProducer);
  });

  it('subscribes to TOPICS.FRIEND_REQUEST on module init', () => {
    handler.onModuleInit();
    expect(streams.stream).toHaveBeenCalledWith(TOPICS.FRIEND_REQUEST);
  });

  it('persists notification, bumps friend badge and pushes to Kafka', async () => {
    handler.onModuleInit();

    topicSubject.next({
      value: {
        requesterId: 'u-req',
        addresseeId: 'u-add',
        friendshipId: 'f-1',
        requesterUsername: 'alice',
        requesterPhotoUrl: 'http://x.png',
      },
    });

    // wait microtasks
    await new Promise((r) => setImmediate(r));

    expect(notificationsService.create).toHaveBeenCalledWith({
      user_id: 'u-add',
      actor_id: 'u-req',
      actor_username: 'alice',
      actor_photo_url: 'http://x.png',
      type: NotificationEventType.FRIEND_REQUEST,
      target_id: 'f-1',
      target_type: 'USER',
    });
    expect(notificationsService.incrementBadges).toHaveBeenCalledWith('u-add', { friend: true });
    expect(kafkaProducer.publishNotificationPush).toHaveBeenCalledWith(expect.objectContaining({
      notification_id: 'notif-1',
      recipient_id: 'u-add',
      actor_id: 'u-req',
      type: NotificationEventType.FRIEND_REQUEST,
    }));
  });

  it('falls back to requesterId when username is omitted, and null photo', async () => {
    handler.onModuleInit();

    topicSubject.next({
      value: {
        requesterId: 'u-req',
        addresseeId: 'u-add',
        friendshipId: 'f-1',
      },
    });

    await new Promise((r) => setImmediate(r));

    expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
      actor_username: 'u-req',
      actor_photo_url: null,
    }));
    expect(kafkaProducer.publishNotificationPush).toHaveBeenCalledWith(expect.objectContaining({
      actor_username: 'u-req',
      actor_photo_url: null,
    }));
  });

  it('catches errors so the stream stays alive (handler keeps consuming events)', async () => {
    notificationsService.create.mockRejectedValueOnce(new Error('mongo down'));
    handler.onModuleInit();

    topicSubject.next({ value: { requesterId: 'a', addresseeId: 'b', friendshipId: 'f' } });
    await new Promise((r) => setImmediate(r));

    // Now send a second event that should still be processed
    notificationsService.create.mockResolvedValueOnce({ _id: { toString: () => 'n-2' } });
    topicSubject.next({ value: { requesterId: 'a2', addresseeId: 'b2', friendshipId: 'f2' } });
    await new Promise((r) => setImmediate(r));

    expect(notificationsService.create).toHaveBeenCalledTimes(2);
    expect(kafkaProducer.publishNotificationPush).toHaveBeenCalledTimes(1);
  });
});

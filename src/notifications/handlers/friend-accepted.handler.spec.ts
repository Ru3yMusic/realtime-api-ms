import { Subject } from 'rxjs';
import { FriendAcceptedHandler } from './friend-accepted.handler';
import { NotificationEventType, TOPICS } from '../../common/types/avro-events.types';

describe('FriendAcceptedHandler', () => {
  let streams: { stream: jest.Mock };
  let notificationsService: any;
  let kafkaProducer: any;
  let handler: FriendAcceptedHandler;
  let topicSubject: Subject<any>;

  beforeEach(() => {
    topicSubject = new Subject<any>();
    streams = { stream: jest.fn().mockReturnValue(topicSubject.asObservable()) };

    notificationsService = {
      create: jest.fn().mockResolvedValue({ _id: { toString: () => 'notif-1' } }),
      incrementBadges: jest.fn().mockResolvedValue(undefined),
    };

    kafkaProducer = {
      publishNotificationPush: jest.fn().mockResolvedValue(undefined),
    };

    handler = new FriendAcceptedHandler(streams as any, notificationsService, kafkaProducer);
  });

  it('subscribes to TOPICS.FRIEND_ACCEPTED on module init', () => {
    handler.onModuleInit();
    expect(streams.stream).toHaveBeenCalledWith(TOPICS.FRIEND_ACCEPTED);
  });

  it('notifies the original requester with addressee info and bumps notification badge', async () => {
    handler.onModuleInit();

    topicSubject.next({
      value: {
        requesterId: 'u-req',
        addresseeId: 'u-add',
        friendshipId: 'f-1',
        addresseeUsername: 'bob',
        addresseePhotoUrl: 'http://b.png',
      },
    });

    await new Promise((r) => setImmediate(r));

    expect(notificationsService.create).toHaveBeenCalledWith({
      user_id: 'u-req',
      actor_id: 'u-add',
      actor_username: 'bob',
      actor_photo_url: 'http://b.png',
      type: NotificationEventType.FRIEND_ACCEPTED,
      target_id: 'f-1',
      target_type: 'USER',
    });
    expect(notificationsService.incrementBadges).toHaveBeenCalledWith('u-req', { notification: true });
    expect(kafkaProducer.publishNotificationPush).toHaveBeenCalledWith(expect.objectContaining({
      notification_id: 'notif-1',
      recipient_id: 'u-req',
      actor_id: 'u-add',
      type: NotificationEventType.FRIEND_ACCEPTED,
    }));
  });

  it('falls back to addresseeId when username is omitted, and null photo', async () => {
    handler.onModuleInit();

    topicSubject.next({
      value: { requesterId: 'a', addresseeId: 'b', friendshipId: 'f' },
    });

    await new Promise((r) => setImmediate(r));

    expect(notificationsService.create).toHaveBeenCalledWith(expect.objectContaining({
      actor_username: 'b',
      actor_photo_url: null,
    }));
  });

  it('catches errors so the stream stays alive', async () => {
    notificationsService.create.mockRejectedValueOnce(new Error('boom'));
    handler.onModuleInit();

    topicSubject.next({ value: { requesterId: 'a', addresseeId: 'b', friendshipId: 'f' } });
    await new Promise((r) => setImmediate(r));

    notificationsService.create.mockResolvedValueOnce({ _id: { toString: () => 'n2' } });
    topicSubject.next({ value: { requesterId: 'a2', addresseeId: 'b2', friendshipId: 'f2' } });
    await new Promise((r) => setImmediate(r));

    expect(notificationsService.create).toHaveBeenCalledTimes(2);
    expect(kafkaProducer.publishNotificationPush).toHaveBeenCalledTimes(1);
  });
});

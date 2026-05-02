import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { NotificationsService } from './notifications.service';
import { Notification } from './schemas/notification.schema';
import { RedisService } from '../redis/redis.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeModelMock() {
  return {
    create:          jest.fn(),
    find:            jest.fn().mockReturnValue({ sort: jest.fn().mockReturnValue({ skip: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) }),
    countDocuments:  jest.fn().mockResolvedValue(0),
    findOneAndUpdate: jest.fn(),
    updateMany:      jest.fn().mockResolvedValue({ modifiedCount: 3 }),
    updateOne:       jest.fn(),
  };
}

function makeRedisMock() {
  return {
    getNotificationBadge:   jest.fn().mockResolvedValue(5),
    clearNotificationBadge: jest.fn().mockResolvedValue(undefined),
    incrementNotificationBadge: jest.fn(),
    incrementFriendBadge:   jest.fn(),
    clearFriendBadge:       jest.fn(),
    getBadges:              jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('NotificationsService — markAllAsRead', () => {
  let service: NotificationsService;
  let modelMock: ReturnType<typeof makeModelMock>;
  let redisMock: ReturnType<typeof makeRedisMock>;

  beforeEach(async () => {
    modelMock = makeModelMock();
    redisMock = makeRedisMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: modelMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    // Silence logger output in tests
    module.useLogger(false);
    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Success path ───────────────────────────────────────────────────────────

  it('updates MongoDB then clears Redis badge on success', async () => {
    await service.markAllAsRead('user-42');

    // MongoDB must be called BEFORE Redis (sequential, source of truth first)
    const mongoOrder = modelMock.updateMany.mock.invocationCallOrder[0];
    const redisOrder = redisMock.clearNotificationBadge.mock.invocationCallOrder[0];
    expect(mongoOrder).toBeLessThan(redisOrder);

    expect(modelMock.updateMany).toHaveBeenCalledWith(
      { user_id: 'user-42', is_read: false },
      { $set: { is_read: true } },
    );
    expect(redisMock.clearNotificationBadge).toHaveBeenCalledWith('user-42');
    expect(redisMock.clearNotificationBadge).toHaveBeenCalledTimes(1);
  });

  it('reads previous badge before updating MongoDB', async () => {
    await service.markAllAsRead('user-42');

    const badgeOrder  = redisMock.getNotificationBadge.mock.invocationCallOrder[0];
    const mongoOrder  = modelMock.updateMany.mock.invocationCallOrder[0];
    expect(badgeOrder).toBeLessThan(mongoOrder);
  });

  // ── Redis failure — retry succeeds ────────────────────────────────────────

  it('retries Redis clear once when first attempt fails, then resolves', async () => {
    redisMock.clearNotificationBadge
      .mockRejectedValueOnce(new Error('Redis timeout'))
      .mockResolvedValueOnce(undefined);

    await expect(service.markAllAsRead('user-42')).resolves.toBeUndefined();

    // MongoDB still updated
    expect(modelMock.updateMany).toHaveBeenCalledTimes(1);
    // Redis attempted twice
    expect(redisMock.clearNotificationBadge).toHaveBeenCalledTimes(2);
  });

  // ── Redis failure — both attempts fail ────────────────────────────────────

  it('does NOT throw when both Redis clear attempts fail (MongoDB is source of truth)', async () => {
    redisMock.clearNotificationBadge
      .mockRejectedValueOnce(new Error('Redis timeout'))
      .mockRejectedValueOnce(new Error('Redis timeout again'));

    await expect(service.markAllAsRead('user-42')).resolves.toBeUndefined();

    // MongoDB was still updated — the operation logically succeeded
    expect(modelMock.updateMany).toHaveBeenCalledTimes(1);
    // Redis was attempted exactly twice
    expect(redisMock.clearNotificationBadge).toHaveBeenCalledTimes(2);
  });
});

// ===========================================================================
// Other NotificationsService methods
// ===========================================================================

describe('NotificationsService — CRUD and badges', () => {
  let service: NotificationsService;
  let modelMock: ReturnType<typeof makeModelMock>;
  let redisMock: ReturnType<typeof makeRedisMock>;

  beforeEach(async () => {
    modelMock = makeModelMock();
    redisMock = makeRedisMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getModelToken(Notification.name), useValue: modelMock },
        { provide: RedisService, useValue: redisMock },
      ],
    }).compile();

    module.useLogger(false);
    service = module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── create ───────────────────────────────────────────────────────────────

  it('create persists the notification with default flags', async () => {
    modelMock.create.mockResolvedValue({ _id: 'n1' });

    const input = {
      user_id: 'u-1',
      actor_id: 'u-2',
      actor_username: 'bob',
      actor_photo_url: null,
      type: 'COMMENT_REACTION',
      target_id: 't-1',
      target_type: 'COMMENT',
    };

    await expect(service.create(input as any)).resolves.toEqual({ _id: 'n1' });

    expect(modelMock.create).toHaveBeenCalledWith({
      ...input,
      is_read: false,
      is_deleted: false,
    });
  });

  // ── incrementBadges ─────────────────────────────────────────────────────

  it('incrementBadges runs notification side only', async () => {
    await service.incrementBadges('u1', { notification: true });

    expect(redisMock.incrementNotificationBadge).toHaveBeenCalledWith('u1');
    expect(redisMock.incrementFriendBadge).not.toHaveBeenCalled();
  });

  it('incrementBadges runs friend side only', async () => {
    await service.incrementBadges('u1', { friend: true });

    expect(redisMock.incrementFriendBadge).toHaveBeenCalledWith('u1');
    expect(redisMock.incrementNotificationBadge).not.toHaveBeenCalled();
  });

  it('incrementBadges runs both sides in parallel', async () => {
    await service.incrementBadges('u1', { notification: true, friend: true });

    expect(redisMock.incrementNotificationBadge).toHaveBeenCalledWith('u1');
    expect(redisMock.incrementFriendBadge).toHaveBeenCalledWith('u1');
  });

  it('incrementBadges with no flags is a no-op (does not touch Redis)', async () => {
    await service.incrementBadges('u1', {});
    expect(redisMock.incrementNotificationBadge).not.toHaveBeenCalled();
    expect(redisMock.incrementFriendBadge).not.toHaveBeenCalled();
  });

  // ── findByUser ──────────────────────────────────────────────────────────

  it('findByUser filters by user + non-deleted, returns data and total', async () => {
    const data = [{ _id: 'n1' }, { _id: 'n2' }];
    modelMock.find.mockReturnValue({
      sort: () => ({ skip: () => ({ limit: () => Promise.resolve(data) }) }),
    });
    modelMock.countDocuments.mockResolvedValue(2);

    const result = await service.findByUser('u-1');

    expect(modelMock.find).toHaveBeenCalledWith({ user_id: 'u-1', is_deleted: false });
    expect(result).toEqual({ data, total: 2 });
  });

  it('findByUser includes type filter when provided', async () => {
    modelMock.find.mockReturnValue({
      sort: () => ({ skip: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    modelMock.countDocuments.mockResolvedValue(0);

    await service.findByUser('u-1', 0, 20, 'FRIEND_REQUEST');

    expect(modelMock.find).toHaveBeenCalledWith({
      user_id: 'u-1', is_deleted: false, type: 'FRIEND_REQUEST',
    });
  });

  // ── markAsRead ──────────────────────────────────────────────────────────

  it('markAsRead updates is_read and returns the document', async () => {
    modelMock.findOneAndUpdate.mockResolvedValue({ _id: 'n1', is_read: true });

    const out = await service.markAsRead('n1', 'u-1');

    expect(modelMock.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'n1', user_id: 'u-1' },
      { $set: { is_read: true } },
      { new: true },
    );
    expect(out).toEqual({ _id: 'n1', is_read: true });
  });

  it('markAsRead throws NotFoundException when no document matches user/id', async () => {
    modelMock.findOneAndUpdate.mockResolvedValue(null);

    await expect(service.markAsRead('n1', 'u-1')).rejects.toThrow();
  });

  // ── softDelete ──────────────────────────────────────────────────────────

  it('softDelete sets is_deleted=true via updateOne', async () => {
    modelMock.updateOne.mockResolvedValue({ matchedCount: 1 });

    await service.softDelete('n1', 'u-1');

    expect(modelMock.updateOne).toHaveBeenCalledWith(
      { _id: 'n1', user_id: 'u-1' },
      { $set: { is_deleted: true } },
    );
  });

  it('softDelete throws NotFoundException when no document was matched', async () => {
    modelMock.updateOne.mockResolvedValue({ matchedCount: 0 });

    await expect(service.softDelete('n1', 'u-1')).rejects.toThrow();
  });

  // ── getBadges / clearFriendBadge ────────────────────────────────────────

  it('getBadges delegates to redis.getBadges', async () => {
    redisMock.getBadges.mockResolvedValue({ notifications: 3, friends: 1 });

    await expect(service.getBadges('u1')).resolves.toEqual({ notifications: 3, friends: 1 });
    expect(redisMock.getBadges).toHaveBeenCalledWith('u1');
  });

  it('clearFriendBadge delegates to redis.clearFriendBadge', async () => {
    await service.clearFriendBadge('u1');

    expect(redisMock.clearFriendBadge).toHaveBeenCalledWith('u1');
  });
});

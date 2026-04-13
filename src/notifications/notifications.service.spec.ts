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

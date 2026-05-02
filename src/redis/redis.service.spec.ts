import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

const mockClient = {
  incr:  jest.fn(),
  get:   jest.fn(),
  del:   jest.fn(),
  quit:  jest.fn().mockResolvedValue(undefined),
};

jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: function Redis(_config: unknown) {
      return mockClient;
    },
  };
});

describe('RedisService', () => {
  const configValues: Record<string, unknown> = {
    'redis.host': 'localhost',
    'redis.port': 6379,
    'redis.password': undefined,
  };

  const config = {
    get: jest.fn((key: string) => configValues[key]),
  } as unknown as ConfigService;

  let service: RedisService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RedisService(config);
    service.onModuleInit();
  });

  // ── Notification badge ──────────────────────────────────────────────────

  it('incrementNotificationBadge calls INCR with the user-keyed badge key', async () => {
    mockClient.incr.mockResolvedValue(7);

    await expect(service.incrementNotificationBadge('u1')).resolves.toBe(7);
    expect(mockClient.incr).toHaveBeenCalledWith('badge:notifications:u1');
  });

  it('getNotificationBadge returns 0 when key is missing (null from Redis)', async () => {
    mockClient.get.mockResolvedValue(null);

    await expect(service.getNotificationBadge('u1')).resolves.toBe(0);
    expect(mockClient.get).toHaveBeenCalledWith('badge:notifications:u1');
  });

  it('getNotificationBadge parses numeric strings from Redis', async () => {
    mockClient.get.mockResolvedValue('5');

    await expect(service.getNotificationBadge('u1')).resolves.toBe(5);
  });

  it('clearNotificationBadge calls DEL on the user-keyed badge key', async () => {
    mockClient.del.mockResolvedValue(1);

    await service.clearNotificationBadge('u1');

    expect(mockClient.del).toHaveBeenCalledWith('badge:notifications:u1');
  });

  // ── Friend badge ────────────────────────────────────────────────────────

  it('incrementFriendBadge calls INCR with the friend badge key', async () => {
    mockClient.incr.mockResolvedValue(3);

    await expect(service.incrementFriendBadge('u1')).resolves.toBe(3);
    expect(mockClient.incr).toHaveBeenCalledWith('badge:friends:u1');
  });

  it('getFriendBadge returns 0 when key is missing', async () => {
    mockClient.get.mockResolvedValue(null);

    await expect(service.getFriendBadge('u1')).resolves.toBe(0);
  });

  it('getFriendBadge parses numeric strings from Redis', async () => {
    mockClient.get.mockResolvedValue('11');

    await expect(service.getFriendBadge('u1')).resolves.toBe(11);
  });

  it('clearFriendBadge calls DEL on the friend badge key', async () => {
    mockClient.del.mockResolvedValue(1);

    await service.clearFriendBadge('u1');

    expect(mockClient.del).toHaveBeenCalledWith('badge:friends:u1');
  });

  // ── getBadges aggregate ────────────────────────────────────────────────

  it('getBadges returns both counters in one call', async () => {
    mockClient.get
      .mockResolvedValueOnce('4')   // notifications
      .mockResolvedValueOnce('2');  // friends

    await expect(service.getBadges('u1')).resolves.toEqual({
      notifications: 4, friends: 2,
    });
  });

  it('getBadges defaults missing keys to 0', async () => {
    mockClient.get.mockResolvedValue(null);

    await expect(service.getBadges('u1')).resolves.toEqual({
      notifications: 0, friends: 0,
    });
  });

  // ── Lifecycle ──────────────────────────────────────────────────────────

  it('onModuleDestroy calls quit on the Redis client', async () => {
    await service.onModuleDestroy();
    expect(mockClient.quit).toHaveBeenCalled();
  });
});

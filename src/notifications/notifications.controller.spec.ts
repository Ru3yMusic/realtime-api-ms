import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let service: jest.Mocked<
    Pick<NotificationsService, 'findByUser' | 'getBadges' | 'markAllAsRead' | 'markAsRead' | 'softDelete' | 'clearFriendBadge'>
  >;

  beforeEach(async () => {
    service = {
      findByUser: jest.fn(),
      getBadges: jest.fn(),
      markAllAsRead: jest.fn(),
      markAsRead: jest.fn(),
      softDelete: jest.fn(),
      clearFriendBadge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [{ provide: NotificationsService, useValue: service }],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  afterEach(() => jest.clearAllMocks());

  it('returns paginated notifications for a user', async () => {
    const docs = [{ _id: 'n1' } as any];
    service.findByUser.mockResolvedValue({ data: docs, total: 1 });

    const result = await controller.list('user-1', '1', '10', 'MENTION');

    expect(service.findByUser).toHaveBeenCalledWith('user-1', 1, 10, 'MENTION');
    expect(result).toEqual({ content: docs, total: 1, page: 1, size: 10 });
  });

  it('gets badges by current user id', async () => {
    service.getBadges.mockResolvedValue({ notifications: 2, friends: 3 });

    const result = await controller.getBadges('user-1');

    expect(service.getBadges).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ notifications: 2, friends: 3 });
  });

  it('marks all notifications as read', async () => {
    service.markAllAsRead.mockResolvedValue(undefined);

    await controller.markAllAsRead('user-9');

    expect(service.markAllAsRead).toHaveBeenCalledWith('user-9');
  });

  it('marks a specific notification as read', async () => {
    service.markAsRead.mockResolvedValue({ _id: 'n-1', is_read: true } as any);

    const result = await controller.markAsRead('n-1', 'user-9');

    expect(service.markAsRead).toHaveBeenCalledWith('n-1', 'user-9');
    expect(result).toEqual({ _id: 'n-1', is_read: true });
  });

  it('deletes one notification and clears friend badges', async () => {
    service.softDelete.mockResolvedValue(undefined);
    service.clearFriendBadge.mockResolvedValue(undefined);

    await controller.delete('n-2', 'user-4');
    await controller.clearFriendBadge('user-4');

    expect(service.softDelete).toHaveBeenCalledWith('n-2', 'user-4');
    expect(service.clearFriendBadge).toHaveBeenCalledWith('user-4');
  });
});

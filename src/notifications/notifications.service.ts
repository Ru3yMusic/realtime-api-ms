import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { NotificationEventType } from '../common/types/avro-events.types';
import { RedisService } from '../redis/redis.service';

export interface CreateNotificationInput {
  user_id:        string;
  actor_id:       string;
  actor_username: string;
  actor_photo_url: string | null;
  type:           NotificationEventType;
  target_id:      string;
  target_type:    string;
}

export interface BadgeIncrement {
  notification?: boolean;
  friend?:       boolean;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name) private model: Model<NotificationDocument>,
    private readonly redis: RedisService,
  ) {}

  async create(input: CreateNotificationInput): Promise<NotificationDocument> {
    return this.model.create({ ...input, is_read: false, is_deleted: false });
  }

  async incrementBadges(userId: string, flags: BadgeIncrement): Promise<void> {
    const ops: Promise<any>[] = [];
    if (flags.notification) ops.push(this.redis.incrementNotificationBadge(userId));
    if (flags.friend)        ops.push(this.redis.incrementFriendBadge(userId));
    await Promise.all(ops);
  }

  async findByUser(
    userId: string,
    page = 0,
    size = 20,
    type?: string,
  ): Promise<{ data: NotificationDocument[]; total: number }> {
    const filter: Record<string, any> = { user_id: userId, is_deleted: false };
    if (type) filter.type = type;
    const [data, total] = await Promise.all([
      this.model.find(filter).sort({ created_at: -1 }).skip(page * size).limit(size),
      this.model.countDocuments(filter),
    ]);
    return { data, total };
  }

  async markAsRead(notificationId: string, userId: string): Promise<NotificationDocument> {
    const doc = await this.model.findOneAndUpdate(
      { _id: notificationId, user_id: userId },
      { $set: { is_read: true } },
      { new: true },
    );
    if (!doc) throw new NotFoundException('Notification not found');
    return doc;
  }

  async markAllAsRead(userId: string): Promise<void> {
    await Promise.all([
      this.model.updateMany({ user_id: userId, is_read: false }, { $set: { is_read: true } }),
      this.redis.clearNotificationBadge(userId),
    ]);
  }

  async softDelete(notificationId: string, userId: string): Promise<void> {
    const result = await this.model.updateOne(
      { _id: notificationId, user_id: userId },
      { $set: { is_deleted: true } },
    );
    if (result.matchedCount === 0) throw new NotFoundException('Notification not found');
  }

  async getBadges(userId: string): Promise<{ notifications: number; friends: number }> {
    return this.redis.getBadges(userId);
  }

  async clearFriendBadge(userId: string): Promise<void> {
    await this.redis.clearFriendBadge(userId);
  }
}

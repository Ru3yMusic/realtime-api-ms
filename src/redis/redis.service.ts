import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Badge-only Redis access for realtime-api-ms. Presence is owned exclusively by realtime-ws-ms. */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.client = new Redis({
      host:     this.config.get<string>('redis.host'),
      port:     this.config.get<number>('redis.port'),
      password: this.config.get<string | undefined>('redis.password'),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
  }

  async incrementNotificationBadge(userId: string): Promise<number> {
    return this.client.incr(`badge:notifications:${userId}`);
  }

  async getNotificationBadge(userId: string): Promise<number> {
    const val = await this.client.get(`badge:notifications:${userId}`);
    return val ? parseInt(val, 10) : 0;
  }

  async clearNotificationBadge(userId: string): Promise<void> {
    await this.client.del(`badge:notifications:${userId}`);
  }

  async incrementFriendBadge(userId: string): Promise<number> {
    return this.client.incr(`badge:friends:${userId}`);
  }

  async getFriendBadge(userId: string): Promise<number> {
    const val = await this.client.get(`badge:friends:${userId}`);
    return val ? parseInt(val, 10) : 0;
  }

  async clearFriendBadge(userId: string): Promise<void> {
    await this.client.del(`badge:friends:${userId}`);
  }

  async getBadges(userId: string): Promise<{ notifications: number; friends: number }> {
    const [notifications, friends] = await Promise.all([
      this.getNotificationBadge(userId),
      this.getFriendBadge(userId),
    ]);
    return { notifications, friends };
  }
}

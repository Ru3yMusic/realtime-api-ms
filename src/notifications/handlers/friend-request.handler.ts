import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EMPTY, from } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { KafkaStreamsService } from '../../kafka/kafka-streams.service';
import { KafkaProducerService } from '../../kafka/kafka.producer';
import { NotificationsService } from '../notifications.service';
import {
  FriendRequestEvent,
  NotificationEventType,
  TOPICS,
} from '../../common/types/avro-events.types';

@Injectable()
export class FriendRequestHandler implements OnModuleInit {
  private readonly logger = new Logger(FriendRequestHandler.name);

  constructor(
    private readonly streams: KafkaStreamsService,
    private readonly notificationsService: NotificationsService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    this.streams
      .stream<FriendRequestEvent>(TOPICS.FRIEND_REQUEST)
      .pipe(
        mergeMap(({ value }) =>
          from(this.handle(value)).pipe(
            catchError((err) => {
              this.logger.error('Failed to handle friend.request', err);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe();

    this.logger.log('Subscribed to stream: ' + TOPICS.FRIEND_REQUEST);
  }

  private async handle(event: FriendRequestEvent): Promise<void> {
    // Persist notification in MongoDB
    await this.notificationsService.create({
      user_id:        event.addresseeId,
      actor_id:       event.requesterId,
      actor_username: event.requesterUsername ?? event.requesterId,
      actor_photo_url: event.requesterPhotoUrl ?? null,
      type:           NotificationEventType.FRIEND_REQUEST,
      target_id:      event.friendshipId,
      target_type:    'USER',
    });

    // Increment Redis badges
    await this.notificationsService.incrementBadges(event.addresseeId, { friend: true });

    // Push via Kafka → ws-ms → WebSocket
    await this.kafkaProducer.publishNotificationPush({
      notification_id: randomUUID(),
      recipient_id:    event.addresseeId,
      actor_id:        event.requesterId,
      actor_username:  event.requesterUsername ?? event.requesterId,
      actor_photo_url: event.requesterPhotoUrl ?? null,
      type:            NotificationEventType.FRIEND_REQUEST,
      target_id:       event.friendshipId,
      target_type:     'USER',
      timestamp:       Date.now(),
    });
  }
}

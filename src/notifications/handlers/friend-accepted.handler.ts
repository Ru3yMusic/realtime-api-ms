import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EMPTY, from } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { KafkaStreamsService } from '../../kafka/kafka-streams.service';
import { KafkaProducerService } from '../../kafka/kafka.producer';
import { NotificationsService } from '../notifications.service';
import {
  FriendAcceptedEvent,
  NotificationEventType,
  TOPICS,
} from '../../common/types/avro-events.types';

@Injectable()
export class FriendAcceptedHandler implements OnModuleInit {
  private readonly logger = new Logger(FriendAcceptedHandler.name);

  constructor(
    private readonly streams: KafkaStreamsService,
    private readonly notificationsService: NotificationsService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {}

  onModuleInit(): void {
    this.streams
      .stream<FriendAcceptedEvent>(TOPICS.FRIEND_ACCEPTED)
      .pipe(
        mergeMap(({ value }) =>
          from(this.handle(value)).pipe(
            catchError((err) => {
              this.logger.error('Failed to handle friend.accepted', err);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe();

    this.logger.log('Subscribed to stream: ' + TOPICS.FRIEND_ACCEPTED);
  }

  private async handle(event: FriendAcceptedEvent): Promise<void> {
    // Notify the original requester that their request was accepted. Reuse
    // the persisted _id as the push event's notification_id so dedupe-by-id
    // on the frontend (WS vs historical load) produces a single card.
    const notification = await this.notificationsService.create({
      user_id:        event.requesterId,
      actor_id:       event.addresseeId,
      actor_username: event.addresseeUsername ?? event.addresseeId,
      actor_photo_url: event.addresseePhotoUrl ?? null,
      type:           NotificationEventType.FRIEND_ACCEPTED,
      target_id:      event.friendshipId,
      target_type:    'USER',
    });

    await this.notificationsService.incrementBadges(event.requesterId, { notification: true });

    await this.kafkaProducer.publishNotificationPush({
      notification_id: notification._id.toString(),
      recipient_id:    event.requesterId,
      actor_id:        event.addresseeId,
      actor_username:  event.addresseeUsername ?? event.addresseeId,
      actor_photo_url: event.addresseePhotoUrl ?? null,
      type:            NotificationEventType.FRIEND_ACCEPTED,
      target_id:       event.friendshipId,
      target_type:     'USER',
      timestamp:       Date.now(),
    });
  }
}

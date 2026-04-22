import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EMPTY, from, Observable } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { randomUUID } from 'crypto';
import { KafkaStreamsService } from '../../kafka/kafka-streams.service';
import { KafkaProducerService } from '../../kafka/kafka.producer';
import { CommentsService } from '../comments.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CommentCreatedEvent,
  NotificationEventType,
  TOPICS,
} from '../../common/types/avro-events.types';

/**
 * Stream handler for realtime.comment.created.
 *
 * Pipeline: persist comment (idempotent) → detect @mentions
 *           → publish notification.push for each mentioned user.
 *
 * Uses mergeMap for concurrent processing (multiple comments can be in-flight simultaneously).
 * catchError → EMPTY ensures one bad message never kills the stream.
 */
@Injectable()
export class CommentCreatedHandler implements OnModuleInit {
  private readonly logger = new Logger(CommentCreatedHandler.name);

  constructor(
    private readonly streams: KafkaStreamsService,
    private readonly commentsService: CommentsService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.streams
      .stream<CommentCreatedEvent>(TOPICS.COMMENT_CREATED)
      .pipe(
        mergeMap(
          ({ value }) =>
            from(this.handle(value)).pipe(
              catchError((err) => {
                this.logger.error(`Failed to process comment.created: ${value.comment_id}`, err);
                return EMPTY;  // stream continues for subsequent messages
              }),
            ),
          10,  // max 10 concurrent MongoDB operations
        ),
      )
      .subscribe();

    this.logger.log('Subscribed to stream: ' + TOPICS.COMMENT_CREATED);
  }

  private async handle(event: CommentCreatedEvent): Promise<void> {
    // Persist — idempotent via unique index on comment_event_id
    await this.commentsService.persistFromEvent(event);

    // Notify mentioned users (skip self-mentions)
    const mentions = (event.mentions ?? []).filter((uid) => uid !== event.user_id);
    await Promise.all(
      mentions.map(async (mentionedUserId) => {
        // Persist notification to MongoDB so it appears in GET /notifications.
        // The returned document's _id is reused as the WS push notification_id
        // so the frontend's dedupe-by-id collapses the WS and HTTP copies of
        // the same notification into a single card (otherwise a random UUID
        // here would produce two entries — one from the live push and another
        // from the historical load).
        const notification = await this.notificationsService.create({
          user_id:        mentionedUserId,
          actor_id:       event.user_id,
          actor_username: event.username,
          actor_photo_url: event.profile_photo_url ?? null,
          type:           NotificationEventType.MENTION,
          target_id:      event.comment_id,
          target_type:    'COMMENT',
        });
        // Increment Redis badge for offline delivery
        await this.notificationsService.incrementBadges(mentionedUserId, { notification: true });
        // Push via Kafka → ws-ms → WebSocket (for online users)
        await this.kafkaProducer.publishNotificationPush({
          notification_id: notification._id.toString(),
          recipient_id:    mentionedUserId,
          actor_id:        event.user_id,
          actor_username:  event.username,
          actor_photo_url: event.profile_photo_url ?? null,
          type:            NotificationEventType.MENTION,
          target_id:       event.comment_id,
          target_type:     'COMMENT',
          timestamp:       event.timestamp,
        });
      }),
    );

    if (mentions.length > 0) {
      this.logger.debug(`${mentions.length} mention notification(s) queued for comment ${event.comment_id}`);
    }
  }
}

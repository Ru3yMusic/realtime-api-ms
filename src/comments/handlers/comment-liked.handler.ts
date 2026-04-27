import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EMPTY, from } from 'rxjs';
import { catchError, concatMap } from 'rxjs/operators';
import { KafkaStreamsService } from '../../kafka/kafka-streams.service';
import { KafkaProducerService } from '../../kafka/kafka.producer';
import { CommentsService } from '../comments.service';
import { NotificationsService } from '../../notifications/notifications.service';
import {
  CommentLikedEvent,
  NotificationEventType,
  TOPICS,
} from '../../common/types/avro-events.types';

/**
 * Stream handler for realtime.comment.liked.
 *
 * Uses concatMap (sequential) because $inc on likes_count must not race.
 * Unlike events are signalled by action === 'unlike' (explicit field — no prefix hack).
 */
@Injectable()
export class CommentLikedHandler implements OnModuleInit {
  private readonly logger = new Logger(CommentLikedHandler.name);

  constructor(
    private readonly streams: KafkaStreamsService,
    private readonly commentsService: CommentsService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly notificationsService: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.streams
      .stream<CommentLikedEvent>(TOPICS.COMMENT_LIKED)
      .pipe(
        concatMap(({ value }) =>
          from(this.handle(value)).pipe(
            catchError((err) => {
              this.logger.error(`Failed to process comment.liked: ${value.comment_id}`, err);
              return EMPTY;
            }),
          ),
        ),
      )
      .subscribe();

    this.logger.log('Subscribed to stream: ' + TOPICS.COMMENT_LIKED);
  }

  private async handle(event: CommentLikedEvent): Promise<void> {
    const isUnlike = event.action === 'unlike';

    if (isUnlike) {
      await this.commentsService.decrementLikes(event.comment_id, event.liker_id);
      return;
    }

    await this.commentsService.incrementLikes(event.comment_id, event.liker_id);

    // Do not notify on self-like
    if (event.liker_id === event.comment_author_id) return;

    // Persist notification to MongoDB so it appears in GET /notifications.
    // Reuse the persisted _id as push notification_id to dedupe WS+HTTP.
    const notification = await this.notificationsService.create({
      user_id:        event.comment_author_id,
      actor_id:       event.liker_id,
      actor_username: event.liker_username,
      actor_photo_url: event.liker_photo_url ?? null,
      type:           NotificationEventType.COMMENT_REACTION,
      target_id:      event.comment_id,
      target_type:    'COMMENT',
    });
    // Increment Redis badge for offline delivery
    await this.notificationsService.incrementBadges(event.comment_author_id, { notification: true });
    // Push via Kafka → ws-ms → WebSocket (for online users)
    await this.kafkaProducer.publishNotificationPush({
      notification_id: notification._id.toString(),
      recipient_id:    event.comment_author_id,
      actor_id:        event.liker_id,
      actor_username:  event.liker_username,
      actor_photo_url: event.liker_photo_url ?? null,
      type:            NotificationEventType.COMMENT_REACTION,
      target_id:       event.comment_id,
      target_type:     'COMMENT',
      timestamp:       event.timestamp,
    });
  }
}

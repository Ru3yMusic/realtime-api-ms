import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EMPTY, from } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { KafkaStreamsService } from '../../kafka/kafka-streams.service';
import { ChatService } from '../chat.service';
import { ChatMessageEvent, TOPICS } from '../../common/types/avro-events.types';

/**
 * Stream handler for realtime.chat.message.
 *
 * Pipeline: decode Avro event → save to MongoDB (idempotent via message_id unique index).
 * Uses mergeMap for concurrent processing — order within station is not critical for persistence.
 * catchError → EMPTY ensures one bad message never kills the stream.
 */
@Injectable()
export class ChatMessageHandler implements OnModuleInit {
  private readonly logger = new Logger(ChatMessageHandler.name);

  constructor(
    private readonly streams: KafkaStreamsService,
    private readonly chatService: ChatService,
  ) {}

  onModuleInit(): void {
    this.streams
      .stream<ChatMessageEvent>(TOPICS.CHAT_MESSAGE)
      .pipe(
        mergeMap(
          ({ value }) =>
            from(this.handle(value)).pipe(
              catchError((err) => {
                this.logger.error(`Failed to process chat.message: ${value.message_id}`, err);
                return EMPTY;
              }),
            ),
          10,  // max 10 concurrent MongoDB operations
        ),
      )
      .subscribe();

    this.logger.log('Subscribed to stream: ' + TOPICS.CHAT_MESSAGE);
  }

  private async handle(event: ChatMessageEvent): Promise<void> {
    await this.chatService.saveMessage({
      message_id:        event.message_id,
      station_id:        event.station_id,
      user_id:           event.user_id,
      username:          event.username,
      profile_photo_url: event.profile_photo_url ?? null,
      content:           event.content,
      mentions:          event.mentions ?? [],
    });

    this.logger.debug(`Persisted chat message ${event.message_id} for station ${event.station_id}`);
  }
}

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';
import { SchemaRegistryService } from '../schema-registry/schema-registry.service';
import { NotificationPushEvent, TOPICS } from '../common/types/avro-events.types';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private producer: Producer;

  constructor(
    private readonly config: ConfigService,
    private readonly schemaRegistry: SchemaRegistryService,
  ) {}

  async onModuleInit(): Promise<void> {
    const isSaslSsl = this.config.get<string>('kafka.securityProtocol') === 'SASL_SSL';
    const kafka = new Kafka({
      clientId: 'realtime-api-ms-producer',
      brokers: [this.config.get<string>('kafka.broker')],
      ...(isSaslSsl && {
        ssl: true,
        sasl: {
          mechanism: 'plain' as const,
          username: this.config.get<string>('kafka.apiKey') ?? '',
          password: this.config.get<string>('kafka.apiSecret') ?? '',
        },
      }),
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: false });
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  /**
   * Publish a failed message to its Dead-Letter Queue (`{topic}.dlq`).
   * Wraps the original payload as base64 and attaches structured error metadata.
   * If the DLQ publish itself fails, logs everything for manual recovery — never throws.
   */
  async publishToDlq(topic: string, message: any, error: Error): Promise<void> {
    const dlqTopic = `${topic}.dlq`;
    try {
      await this.producer.send({
        topic: dlqTopic,
        messages: [
          {
            key: message.key?.toString(),
            value: JSON.stringify({
              originalTopic:     topic,
              originalPartition: message.partition,
              originalOffset:    message.offset,
              error:             error.message,
              errorStack:        error.stack,
              timestamp:         new Date().toISOString(),
              rawPayload:        message.value?.toString('base64'),
            }),
            headers: {
              'dlq.error':          error.message,
              'dlq.original-topic': topic,
            },
          },
        ],
      });
      this.logger.warn(`Message sent to DLQ: ${dlqTopic}`);
    } catch (dlqError) {
      this.logger.error(`Failed to publish to DLQ ${dlqTopic}`, dlqError);
      // Message is lost at this point — log full payload for manual recovery
      this.logger.error('Lost message payload', {
        topic,
        message: message.value?.toString(),
      });
    }
  }

  /**
   * Publish notification.push so realtime-ws-ms pushes it to the recipient via WebSocket.
   *
   * Failure mode: if the publish fails (broker down, schema registry unavailable,
   * payload encode error) the error is logged but NOT re-thrown. The notification
   * has already been persisted in Mongo by the caller; re-throwing here would
   * advance the Kafka offset of the upstream event all the same (notif lost AND
   * consumer crashes). Logging keeps the failure visible without blowing up the
   * handler pipeline. The user will still see the notification after refresh via
   * the HTTP notifications history — the WS push is just the realtime hint.
   */
  async publishNotificationPush(event: NotificationPushEvent): Promise<void> {
    try {
      const value = this.schemaRegistry.encode(TOPICS.NOTIFICATION_PUSH, event);
      await this.producer.send({
        topic: TOPICS.NOTIFICATION_PUSH,
        messages: [{ key: event.recipient_id, value }],
      });
      this.logger.debug(`Published notification.push → ${event.recipient_id} (${event.type})`);
    } catch (err) {
      this.logger.error(
        `Failed to publish notification.push → recipient=${event.recipient_id} type=${event.type}`,
        err,
      );
    }
  }
}

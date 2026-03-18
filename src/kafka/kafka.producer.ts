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
    const kafka = new Kafka({
      clientId: 'realtime-api-ms-producer',
      brokers: [this.config.get<string>('kafka.broker')],
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  /** Publish notification.push so realtime-ws-ms pushes it to the recipient via WebSocket. */
  async publishNotificationPush(event: NotificationPushEvent): Promise<void> {
    const value = this.schemaRegistry.encode(TOPICS.NOTIFICATION_PUSH, event);
    await this.producer.send({
      topic: TOPICS.NOTIFICATION_PUSH,
      messages: [{ key: event.recipient_id, value }],
    });
    this.logger.debug(`Published notification.push → ${event.recipient_id} (${event.type})`);
  }
}

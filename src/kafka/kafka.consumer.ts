import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, EachMessagePayload, Kafka } from 'kafkajs';
import { SchemaRegistryService } from '../schema-registry/schema-registry.service';
import { KafkaStreamsService } from './kafka-streams.service';
import { AVRO_TOPICS, JSON_TOPICS } from '../common/types/avro-events.types';

/**
 * Raw Kafka consumer — the only component that touches KafkaJS directly.
 * Decodes each message (Avro or JSON) and dispatches into KafkaStreamsService.
 * Zero business logic here.
 *
 * Two separate consumer groups:
 *   api-ms-avro → realtime.comment.created, realtime.comment.liked
 *   api-ms-json → user.friend.request, user.friend.accepted
 */
@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private avroConsumer: Consumer;
  private jsonConsumer: Consumer;

  constructor(
    private readonly config: ConfigService,
    private readonly schemaRegistry: SchemaRegistryService,
    private readonly streams: KafkaStreamsService,
  ) {}

  async onModuleInit(): Promise<void> {
    const broker = this.config.get<string>('kafka.broker');
    const kafka = new Kafka({
      clientId: 'realtime-api-ms-consumer',
      brokers: [broker],
    });

    await Promise.all([
      this.startAvroConsumer(kafka),
      this.startJsonConsumer(kafka),
    ]);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.avroConsumer?.disconnect(),
      this.jsonConsumer?.disconnect(),
    ]);
  }

  // ── Avro consumer group ───────────────────────────────────────────────────

  private async startAvroConsumer(kafka: Kafka): Promise<void> {
    this.avroConsumer = kafka.consumer({
      groupId: this.config.get<string>('kafka.groupIdAvro'),
    });
    await this.avroConsumer.connect();
    await this.avroConsumer.subscribe({ topics: AVRO_TOPICS, fromBeginning: false });
    await this.avroConsumer.run({ eachMessage: (p) => this.handleAvro(p) });
    this.logger.log(`Avro consumer subscribed to: ${AVRO_TOPICS.join(', ')}`);
  }

  private async handleAvro({ topic, message, partition, offset }: EachMessagePayload): Promise<void> {
    if (!message.value) return;
    try {
      const value = this.schemaRegistry.decode(topic, message.value);
      this.streams.dispatch({
        topic, partition,
        offset: offset.toString(),
        key: message.key?.toString() ?? null,
        value,
        timestamp: message.timestamp,
      });
    } catch (err) {
      this.logger.error(`Avro decode failed — topic: ${topic}, offset: ${offset}`, err);
      await this.publishToDlq(topic, message.value, err);
    }
  }

  // ── JSON consumer group ───────────────────────────────────────────────────

  private async startJsonConsumer(kafka: Kafka): Promise<void> {
    this.jsonConsumer = kafka.consumer({
      groupId: this.config.get<string>('kafka.groupIdJson'),
    });
    await this.jsonConsumer.connect();
    await this.jsonConsumer.subscribe({ topics: JSON_TOPICS, fromBeginning: false });
    await this.jsonConsumer.run({ eachMessage: (p) => this.handleJson(p) });
    this.logger.log(`JSON consumer subscribed to: ${JSON_TOPICS.join(', ')}`);
  }

  private async handleJson({ topic, message, partition, offset }: EachMessagePayload): Promise<void> {
    if (!message.value) return;
    try {
      const value = JSON.parse(message.value.toString());
      this.streams.dispatch({
        topic, partition,
        offset: offset.toString(),
        key: message.key?.toString() ?? null,
        value,
        timestamp: message.timestamp,
      });
    } catch (err) {
      this.logger.error(`JSON decode failed — topic: ${topic}, offset: ${offset}`, err);
    }
  }

  // ── Dead-letter queue ─────────────────────────────────────────────────────

  private async publishToDlq(topic: string, rawValue: Buffer, err: Error): Promise<void> {
    // Future: inject a DLQ producer and publish to `realtime.dlq`
    this.logger.warn(`DLQ: topic=${topic}, error=${err.message}`);
  }
}

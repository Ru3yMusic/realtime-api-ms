import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';

export interface KafkaStreamMessage<T = unknown> {
  topic:     string;
  partition: number;
  offset:    string;
  key:       string | null;
  value:     T;
  timestamp: string;
}

/**
 * RxJS-based Kafka Streams abstraction for realtime-api-ms.
 *
 * Each topic maps to a Subject<KafkaStreamMessage>. The KafkaConsumerService
 * is the sole writer; domain handlers subscribe via stream<T>(topic).
 *
 * Isolation guarantee: errors inside handler pipelines use catchError → EMPTY
 * so they never terminate the Subject for other subscribers.
 *
 * Concurrency: handlers choose mergeMap (concurrent) or concatMap (sequential)
 * depending on whether event ordering within a partition matters.
 */
@Injectable()
export class KafkaStreamsService {
  private readonly logger = new Logger(KafkaStreamsService.name);
  private readonly subjects = new Map<string, Subject<KafkaStreamMessage<unknown>>>();

  /**
   * Called by KafkaConsumerService for each decoded message.
   * Creates the subject lazily if it doesn't yet exist.
   */
  dispatch<T>(message: KafkaStreamMessage<T>): void {
    const subject = this.getOrCreate(message.topic);
    subject.next(message as KafkaStreamMessage<unknown>);
  }

  /**
   * Returns a typed Observable for a topic.
   * Safe to call before the consumer starts — messages will arrive once it does.
   */
  stream<T>(topic: string): Observable<KafkaStreamMessage<T>> {
    return this.getOrCreate(topic).asObservable() as Observable<KafkaStreamMessage<T>>;
  }

  private getOrCreate(topic: string): Subject<KafkaStreamMessage<unknown>> {
    if (!this.subjects.has(topic)) {
      this.subjects.set(topic, new Subject<KafkaStreamMessage<unknown>>());
      this.logger.debug(`Stream created for topic: ${topic}`);
    }
    return this.subjects.get(topic)!;
  }
}

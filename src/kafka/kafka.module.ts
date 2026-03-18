import { Module, Global } from '@nestjs/common';
import { KafkaStreamsService } from './kafka-streams.service';
import { KafkaConsumerService } from './kafka.consumer';
import { KafkaProducerService } from './kafka.producer';

@Global()
@Module({
  providers: [KafkaStreamsService, KafkaConsumerService, KafkaProducerService],
  exports: [KafkaStreamsService, KafkaProducerService],
})
export class KafkaModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { APP_GUARD } from '@nestjs/core';
import { resolve } from 'node:path';
import configuration from './config/configuration';
import { SchemaRegistryModule } from './schema-registry/schema-registry.module';
import { RedisModule } from './redis/redis.module';
import { KafkaModule } from './kafka/kafka.module';
import { CommentsModule } from './comments/comments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ChatModule } from './chat/chat.module';
import { JwtGuard } from './common/guards/jwt.guard';

@Module({
  imports: [
    // envFilePath anclado a __dirname (= dist/ en runtime), NO al cwd del
    // proceso. Así el .env del servicio se carga sin importar desde dónde
    // se lance (npm --prefix, IntelliJ Run Config, docker, etc.).
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: resolve(__dirname, '..', '.env'),
    }),
    // forRootAsync con ConfigService — así el fail-fast de configuration.ts
    // (required('MONGODB_URI', ...)) corre ANTES de que mongoose intente
    // conectar. Antes esto leía process.env.MONGODB_URI directo y bypaseaba
    // la validación.
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('mongodb.uri'),
      }),
    }),
    SchemaRegistryModule,
    RedisModule,
    KafkaModule,
    CommentsModule,
    NotificationsModule,
    ChatModule,
  ],
  providers: [
    // Validates Bearer JWT (RS256) on every NestJS-handled HTTP request.
    // Raw Express routes (e.g. /health registered in main.ts) are NOT affected.
    {
      provide: APP_GUARD,
      useClass: JwtGuard,
    },
  ],
})
export class AppModule {}

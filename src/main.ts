import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './exception/global-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  // Health endpoint registered before globalPrefix so it stays at /health (used by Docker)
  app.getHttpAdapter().get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.setGlobalPrefix('api');
  // CORS is handled exclusively by api-gateway. Do NOT enable here.
  // Enabling CORS at both layers results in a duplicated
  // "Access-Control-Allow-Origin: *, *" header that browsers reject.

  const port = process.env.PORT ?? 3002;
  await app.listen(port);
  console.log(`realtime-api-ms running on port ${port}`);
}

bootstrap();

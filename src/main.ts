import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { collectDefaultMetrics, register } from 'prom-client';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './exception/global-exception.filter';

const normalizeOtelEndpoint = (endpoint: string): string => endpoint.replace(/\/$/, '');

async function bootstrap() {
  const otelEndpoint = normalizeOtelEndpoint(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
  );

  const otelSdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: `${otelEndpoint}/v1/traces`,
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  await otelSdk.start();
  collectDefaultMetrics();

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  // Health endpoint registered before globalPrefix so it stays at /health (used by Docker)
  app.getHttpAdapter().get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.getHttpAdapter().get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
  });
  app.setGlobalPrefix('api');
  app.enableCors();

  const port = process.env.PORT ?? 3002;
  await app.listen(port);

  const shutdown = async () => {
    await otelSdk.shutdown();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`realtime-api-ms running on port ${port}`);
}

bootstrap();

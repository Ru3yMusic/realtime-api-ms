import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { collectDefaultMetrics, register } from 'prom-client';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './exception/global-exception.filter';

const normalizeOtelEndpoint = (endpoint: string): string => endpoint.replace(/\/$/, '');

async function bootstrap() {
  const otelEndpointRaw = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const otelEndpoint = otelEndpointRaw ? normalizeOtelEndpoint(otelEndpointRaw) : '';
  const otelSdk = otelEndpoint
    ? new NodeSDK({
        traceExporter: new OTLPTraceExporter({
          url: `${otelEndpoint}/v1/traces`,
        }),
        instrumentations: [getNodeAutoInstrumentations()],
      })
    : null;

  if (otelSdk) {
    otelSdk.start();
  }
  collectDefaultMetrics();

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  // Health endpoint registered before globalPrefix so it stays at /health (used by Docker).
  // Verifies the Mongo connection is in "connected" state (readyState === 1). If any
  // dependency is degraded the endpoint responds 503 so the orchestrator stops routing
  // traffic to this instance and restarts it on its own policy. Happy path stays 200.
  const mongoConnection = app.get<Connection>(getConnectionToken());
  app.getHttpAdapter().get('/health', (_req, res) => {
    const mongoOk = mongoConnection?.readyState === 1;
    if (mongoOk) {
      res.json({ status: 'ok', mongo: 'up' });
    } else {
      res.status(503).json({ status: 'degraded', mongo: 'down' });
    }
  });
  app.getHttpAdapter().get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', register.contentType);
    res.send(await register.metrics());
  });
  app.setGlobalPrefix('api');
  // CORS is handled exclusively by api-gateway. Do NOT enable here.
  // Enabling CORS at both layers results in a duplicated
  // "Access-Control-Allow-Origin: *, *" header that browsers reject.

  const port = process.env.PORT ?? 3002;
  await app.listen(port);

  // Tune the underlying Node HTTP server for high concurrency.
  // keepAliveTimeout 65s keeps idle sockets open longer than typical
  // upstream proxies (api-gateway, ALB) so we never close a socket the
  // proxy still considers alive. headersTimeout MUST be > keepAliveTimeout
  // to avoid a Node race that can deadlock keep-alive sockets.
  const httpServer = app.getHttpServer();
  httpServer.keepAliveTimeout =
    Number(process.env.HTTP_KEEP_ALIVE_TIMEOUT_MS) || 65_000;
  httpServer.headersTimeout =
    Number(process.env.HTTP_HEADERS_TIMEOUT_MS) || 66_000;

  const shutdown = async () => {
    if (otelSdk) {
      await otelSdk.shutdown();
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(`realtime-api-ms running on port ${port}`);
}

bootstrap();

import './instrumentation';
import 'reflect-metadata';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import type { MicroserviceOptions } from '@nestjs/microservices';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new ConsoleLogger({ colors: false, json: true }));
  app.enableShutdownHooks();
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'bus.catalog.v1',
      protoPath: require.resolve('@bus/contracts-proto/catalog.proto'),
      url: process.env.CATALOG_GRPC_BIND ?? '0.0.0.0:50051',
    },
  });

  await app.startAllMicroservices();
  const port = Number(process.env.CATALOG_HTTP_PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Catalog HTTP health listening on http://localhost:${port}/health`, 'Bootstrap');
  Logger.log('Catalog gRPC listening on 0.0.0.0:50051', 'Bootstrap');
}

void bootstrap();

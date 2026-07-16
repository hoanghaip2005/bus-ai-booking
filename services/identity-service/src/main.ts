import './instrumentation';
import 'reflect-metadata';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Transport, type MicroserviceOptions } from '@nestjs/microservices';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(new ConsoleLogger({ colors: false, json: true }));
  app.enableShutdownHooks();
  const grpcBind = process.env.IDENTITY_GRPC_BIND ?? '0.0.0.0:50056';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'bus.identity.v1',
      protoPath: require.resolve('@bus/contracts-proto/identity.proto'),
      url: grpcBind,
    },
  });

  await app.startAllMicroservices();
  const port = Number(process.env.IDENTITY_HTTP_PORT ?? 3008);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Identity HTTP health listening on http://localhost:${port}/health`, 'Bootstrap');
  Logger.log(`Identity gRPC listening on ${grpcBind}`, 'Bootstrap');
}

void bootstrap();

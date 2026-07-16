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
  const grpcBind = process.env.BOOKING_GRPC_BIND ?? '0.0.0.0:50053';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'bus.booking.v1',
      protoPath: require.resolve('@bus/contracts-proto/booking.proto'),
      url: grpcBind,
    },
  });

  await app.startAllMicroservices();
  const port = Number(process.env.BOOKING_HTTP_PORT ?? 3004);
  await app.listen(port, '0.0.0.0');
  Logger.log(`Booking HTTP health listening on http://localhost:${port}/health`, 'Bootstrap');
  Logger.log(`Booking gRPC listening on ${grpcBind}`, 'Bootstrap');
}

void bootstrap();

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
  const grpcBind = process.env.SEAT_INVENTORY_GRPC_BIND ?? '0.0.0.0:50052';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: 'bus.seat_inventory.v1',
      protoPath: require.resolve('@bus/contracts-proto/seat-inventory.proto'),
      url: grpcBind,
    },
  });

  await app.startAllMicroservices();
  const port = Number(process.env.SEAT_INVENTORY_HTTP_PORT ?? 3003);
  await app.listen(port, '0.0.0.0');
  Logger.log(
    `Seat Inventory HTTP health listening on http://localhost:${port}/health`,
    'Bootstrap',
  );
  Logger.log(`Seat Inventory gRPC listening on ${grpcBind}`, 'Bootstrap');
}

void bootstrap();

import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { CatalogClient } from './catalog.client';
import { RequestContextMiddleware } from './request-context.middleware';
import { SeatInventoryController } from './seat-inventory.controller';
import { SeatInventoryDatabase } from './seat-inventory.database';
import { SeatHoldStore } from './seat-hold.store';
import { SeatInventoryService } from './seat-inventory.service';
import { SeatStateRepository } from './seat-state.repository';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'CATALOG_GRPC',
        transport: Transport.GRPC,
        options: {
          package: 'bus.catalog.v1',
          protoPath: require.resolve('@bus/contracts-proto/catalog.proto'),
          url: process.env.CATALOG_GRPC_URL ?? 'localhost:50051',
        },
      },
    ]),
  ],
  controllers: [SeatInventoryController],
  providers: [
    SeatInventoryDatabase,
    SeatStateRepository,
    SeatHoldStore,
    CatalogClient,
    SeatInventoryService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

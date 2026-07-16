import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { BookingController } from './booking.controller';
import { BookingDatabase } from './booking.database';
import { BookingExpiryReconciler } from './booking-expiry.reconciler';
import { BookingOutboxRelay } from './booking-outbox.relay';
import { BookingOutboxRepository } from './booking-outbox.repository';
import { KafkaOutboxPublisher, RabbitOutboxPublisher } from './booking-outbox.publishers';
import { BookingRepository } from './booking.repository';
import { BookingService } from './booking.service';
import { CatalogClient } from './catalog.client';
import { RequestContextMiddleware } from './request-context.middleware';
import { PaymentClient } from './payment.client';
import { SeatInventoryClient } from './seat-inventory.client';

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
      {
        name: 'SEAT_INVENTORY_GRPC',
        transport: Transport.GRPC,
        options: {
          package: 'bus.seat_inventory.v1',
          protoPath: require.resolve('@bus/contracts-proto/seat-inventory.proto'),
          url: process.env.SEAT_INVENTORY_GRPC_URL ?? 'localhost:50052',
        },
      },
      {
        name: 'PAYMENT_GRPC',
        transport: Transport.GRPC,
        options: {
          package: 'bus.payment.v1',
          protoPath: require.resolve('@bus/contracts-proto/payment.proto'),
          url: process.env.PAYMENT_GRPC_URL ?? 'localhost:50054',
        },
      },
    ]),
  ],
  controllers: [BookingController],
  providers: [
    BookingDatabase,
    BookingOutboxRepository,
    RabbitOutboxPublisher,
    KafkaOutboxPublisher,
    BookingOutboxRelay,
    BookingRepository,
    CatalogClient,
    SeatInventoryClient,
    PaymentClient,
    BookingService,
    BookingExpiryReconciler,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { BookingNotificationClient } from './booking.client';
import { NotificationController } from './notification.controller';
import { NotificationDatabase } from './notification.database';
import { NotificationRabbitConsumer } from './notification-rabbit.consumer';
import { NotificationRepository } from './notification.repository';
import { NotificationService } from './notification.service';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'BOOKING_GRPC',
        transport: Transport.GRPC,
        options: {
          package: 'bus.booking.v1',
          protoPath: require.resolve('@bus/contracts-proto/booking.proto'),
          url: process.env.BOOKING_GRPC_URL ?? 'localhost:50053',
        },
      },
    ]),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationDatabase,
    NotificationRepository,
    BookingNotificationClient,
    NotificationService,
    NotificationRabbitConsumer,
  ],
})
export class AppModule {}

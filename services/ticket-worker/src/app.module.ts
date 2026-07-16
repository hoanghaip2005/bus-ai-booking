import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { BookingFulfillmentClient } from './booking.client';
import { TicketController } from './ticket.controller';
import { TicketDatabase } from './ticket.database';
import { TicketGenerator } from './ticket.generator';
import { TicketRabbitConsumer } from './ticket-rabbit.consumer';
import { TicketRepository } from './ticket.repository';
import { TicketService } from './ticket.service';

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
  controllers: [TicketController],
  providers: [
    TicketDatabase,
    TicketRepository,
    TicketGenerator,
    BookingFulfillmentClient,
    TicketService,
    TicketRabbitConsumer,
  ],
})
export class AppModule {}

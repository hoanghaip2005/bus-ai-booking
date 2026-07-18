import { ApolloDriver, type ApolloDriverConfig } from '@nestjs/apollo';
import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { ClientsModule, Transport } from '@nestjs/microservices';

import type { RequestWithContext } from './request-context.middleware';
import { RequestContextMiddleware } from './request-context.middleware';
import { BookingGatewayService } from './booking.service';
import { HealthController } from './health.controller';
import { HealthResolver } from './health.resolver';
import { IdentityGatewayService } from './identity.service';
import { CatalogHealthService } from './catalog-health.service';
import { SeatStatusSubscriptionService } from './seat-status-subscription.service';
import { SeatInventoryGatewayService } from './seat-inventory.service';
import { TicketGatewayService } from './ticket.service';
import { AnalyticsGatewayService } from './analytics.service';
import { longScalar } from './long.scalar';

@Module({
  imports: [
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      typePaths: [require.resolve('@bus/contracts-graphql/schema')],
      graphiql: process.env.NODE_ENV !== 'production',
      introspection: process.env.NODE_ENV !== 'production',
      resolvers: { Long: longScalar },
      subscriptions: {
        'graphql-ws': true,
      },
      context: ({ req }: { req?: RequestWithContext }) => ({
        requestId: req?.requestId,
        searchSessionId: req?.searchSessionId,
        checkoutSessionId: req?.checkoutSessionId,
        authorization: req?.headers.authorization,
      }),
    }),
    ClientsModule.register([
      {
        name: 'IDENTITY_GRPC',
        transport: Transport.GRPC,
        options: {
          package: 'bus.identity.v1',
          protoPath: require.resolve('@bus/contracts-proto/identity.proto'),
          url: process.env.IDENTITY_GRPC_URL ?? 'localhost:50056',
        },
      },
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
        name: 'BOOKING_GRPC',
        transport: Transport.GRPC,
        options: {
          package: 'bus.booking.v1',
          protoPath: require.resolve('@bus/contracts-proto/booking.proto'),
          url: process.env.BOOKING_GRPC_URL ?? 'localhost:50053',
        },
      },
      {
        name: 'ANALYTICS_GRPC',
        transport: Transport.GRPC,
        options: {
          package: 'bus.analytics.v1',
          protoPath: require.resolve('@bus/contracts-proto/analytics.proto'),
          url: process.env.ANALYTICS_GRPC_URL ?? 'localhost:50057',
        },
      },
      {
        name: 'TICKET_GRPC',
        transport: Transport.GRPC,
        options: {
          package: 'bus.ticket.v1',
          protoPath: require.resolve('@bus/contracts-proto/ticket.proto'),
          url: process.env.TICKET_GRPC_URL ?? 'localhost:50055',
        },
      },
    ]),
  ],
  controllers: [HealthController],
  providers: [
    HealthResolver,
    CatalogHealthService,
    SeatInventoryGatewayService,
    SeatStatusSubscriptionService,
    BookingGatewayService,
    TicketGatewayService,
    IdentityGatewayService,
    AnalyticsGatewayService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

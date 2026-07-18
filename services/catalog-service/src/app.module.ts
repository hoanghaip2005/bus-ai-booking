import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { CatalogController } from './catalog.controller';
import { CatalogDatabase } from './catalog.database';
import { CatalogService } from './catalog.service';
import { LocationRepository } from './location.repository';
import { RequestContextMiddleware } from './request-context.middleware';
import { SearchAnalyticsPublisher, SearchKafkaOutboxPublisher } from './search-analytics.publisher';
import { SearchOutboxRelay } from './search-outbox.relay';
import { SearchOutboxRepository } from './search-outbox.repository';
import { TripRepository } from './trip.repository';
import { TripSearchCache } from './trip-search-cache';

@Module({
  controllers: [CatalogController],
  providers: [
    CatalogDatabase,
    LocationRepository,
    TripRepository,
    TripSearchCache,
    SearchOutboxRepository,
    SearchAnalyticsPublisher,
    SearchKafkaOutboxPublisher,
    SearchOutboxRelay,
    CatalogService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

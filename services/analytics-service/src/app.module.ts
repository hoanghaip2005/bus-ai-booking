import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { AnalyticsConsumer } from './analytics.consumer';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsDatabase } from './analytics.database';
import { AnalyticsService } from './analytics.service';
import { RequestContextMiddleware } from './request-context.middleware';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsDatabase, AnalyticsService, AnalyticsConsumer],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

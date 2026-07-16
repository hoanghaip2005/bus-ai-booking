import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { IdentityController } from './identity.controller';
import { IdentityDatabase } from './identity.database';
import { IdentityRepository } from './identity.repository';
import { IdentityService } from './identity.service';
import { RequestContextMiddleware } from './request-context.middleware';
import { IdentityTokenService } from './token.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityDatabase, IdentityRepository, IdentityTokenService, IdentityService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';

import { PaymentController } from './payment.controller';
import { PaymentDatabase } from './payment.database';
import { PaymentKafkaOutboxPublisher } from './payment-outbox.publisher';
import { PaymentOutboxRelay } from './payment-outbox.relay';
import { PaymentOutboxRepository } from './payment-outbox.repository';
import { PaymentRepository } from './payment.repository';
import { PaymentService } from './payment.service';
import { RequestContextMiddleware } from './request-context.middleware';

@Module({
  controllers: [PaymentController],
  providers: [
    PaymentDatabase,
    PaymentOutboxRepository,
    PaymentKafkaOutboxPublisher,
    PaymentOutboxRelay,
    PaymentRepository,
    PaymentService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware).forRoutes('*');
  }
}

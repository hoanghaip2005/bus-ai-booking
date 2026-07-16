import type { BookingPaidV1 } from '@bus/contracts-events';
import {
  parseBookingPaidV1,
  RabbitWorkflowConsumer,
  type WorkflowMessage,
} from '@bus/worker-runtime';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { NotificationService } from './notification.service';

@Injectable()
export class NotificationRabbitConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly consumer: RabbitWorkflowConsumer<BookingPaidV1>;

  constructor(@Inject(NotificationService) notificationService: NotificationService) {
    this.consumer = new RabbitWorkflowConsumer({
      service: 'notification-worker',
      queueName: process.env.NOTIFICATION_QUEUE_NAME ?? 'bus.notification.booking-paid.v1',
      bindingKey: 'booking.paid.v1',
      workerExchange: process.env.NOTIFICATION_WORKER_EXCHANGE ?? 'bus.notification.worker',
      maxAttempts: positiveInteger(process.env.NOTIFICATION_WORKER_MAX_ATTEMPTS, 5),
      retryDelayMs: positiveInteger(process.env.NOTIFICATION_WORKER_RETRY_DELAY_MS, 1_000),
      prefetch: positiveInteger(process.env.NOTIFICATION_WORKER_PREFETCH, 10),
      parse: parseBookingPaidV1,
      handle: (message: WorkflowMessage<BookingPaidV1>) =>
        notificationService.processBookingPaid(message.event, message.headers),
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.consumer.start();
  }

  isReady(): boolean {
    return this.consumer.isReady();
  }

  onModuleDestroy(): Promise<void> {
    return this.consumer.close();
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

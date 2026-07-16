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

import { TicketService } from './ticket.service';

@Injectable()
export class TicketRabbitConsumer implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly consumer: RabbitWorkflowConsumer<BookingPaidV1>;

  constructor(@Inject(TicketService) ticketService: TicketService) {
    this.consumer = new RabbitWorkflowConsumer({
      service: 'ticket-worker',
      queueName: process.env.TICKET_QUEUE_NAME ?? 'bus.ticket.booking-paid.v1',
      bindingKey: 'booking.paid.v1',
      workerExchange: process.env.TICKET_WORKER_EXCHANGE ?? 'bus.ticket.worker',
      maxAttempts: positiveInteger(process.env.TICKET_WORKER_MAX_ATTEMPTS, 5),
      retryDelayMs: positiveInteger(process.env.TICKET_WORKER_RETRY_DELAY_MS, 1_000),
      prefetch: positiveInteger(process.env.TICKET_WORKER_PREFETCH, 5),
      parse: parseBookingPaidV1,
      handle: (message: WorkflowMessage<BookingPaidV1>) =>
        ticketService.processBookingPaid(message.event, message.headers),
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

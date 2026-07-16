import { incrementCounter, logEvent } from '@bus/observability';
import {
  Inject,
  Injectable,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { BookingService } from './booking.service';

@Injectable()
export class BookingExpiryReconciler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly intervalMs = positiveInteger(process.env.BOOKING_EXPIRY_POLL_MS, 1_000);
  private readonly batchSize = positiveInteger(process.env.BOOKING_EXPIRY_BATCH_SIZE, 50);
  private timer?: NodeJS.Timeout;
  private scheduled?: Promise<number>;

  constructor(@Inject(BookingService) private readonly bookingService: BookingService) {}

  onApplicationBootstrap(): void {
    void this.runScheduled();
    this.timer = setInterval(() => void this.runScheduled(), this.intervalMs);
    this.timer.unref();
  }

  async reconcileOnce(): Promise<number> {
    const [expired, cancellationReleases] = await Promise.all([
      this.bookingService.reconcileExpiredBookings(this.batchSize),
      this.bookingService.reconcileCancelledSeatReleases(this.batchSize),
    ]);
    return expired + cancellationReleases;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.scheduled;
  }

  private runScheduled(): Promise<number> {
    if (this.scheduled) return this.scheduled;
    this.scheduled = this.reconcileOnce()
      .then((transitioned) => {
        if (transitioned > 0) {
          incrementCounter('bus.booking.expiry.reconciled', {}, transitioned);
          logEvent({
            service: 'booking-service',
            event: 'booking.expiry-reconciler.completed',
            message: 'Expired pending bookings were reconciled.',
            fields: { transitioned },
          });
        }
        return transitioned;
      })
      .catch((error: unknown) => {
        incrementCounter('bus.booking.expiry.reconcile_failed');
        logEvent({
          service: 'booking-service',
          level: 'error',
          event: 'booking.expiry-reconciler.failed',
          message: 'Booking expiry reconciliation failed.',
          fields: { reason: error instanceof Error ? error.name : 'UnknownError' },
        });
        return 0;
      })
      .finally(() => {
        this.scheduled = undefined;
      });
    return this.scheduled;
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

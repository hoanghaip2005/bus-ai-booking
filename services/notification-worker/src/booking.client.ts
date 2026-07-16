import { activePropagationHeaders, createRequestId } from '@bus/observability';
import { Metadata } from '@grpc/grpc-js';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { ClientGrpc } from '@nestjs/microservices';
import { firstValueFrom, type Observable, timeout } from 'rxjs';

interface BookingClientContract {
  getFulfillmentSnapshot(
    input: { bookingId: string; requestId: string },
    metadata?: Metadata,
  ): Observable<{
    snapshot?: {
      bookingId: string;
      bookingCode: string;
      contactEmail: string;
      status: number | string;
    };
    requestId: string;
  }>;
}

const SYSTEM_ACTOR_ID = '00000000-0000-4000-8000-000000000001';

@Injectable()
export class BookingNotificationClient implements OnModuleInit {
  private client?: BookingClientContract;

  constructor(@Inject('BOOKING_GRPC') private readonly grpcClient: ClientGrpc) {}

  onModuleInit(): void {
    this.client = this.grpcClient.getService<BookingClientContract>('BookingService');
  }

  async getRecipient(
    bookingId: string,
    requestId: string,
    propagationHeaders: Record<string, string>,
  ): Promise<{
    bookingId: string;
    bookingCode: string;
    contactEmail: string;
    status: 'ACTIVE' | 'CANCELLED';
  }> {
    if (!this.client)
      throw namedError('BookingDependencyUnavailable', 'Booking client is unavailable.');
    const metadata = new Metadata();
    metadata.set('x-request-id', createRequestId(requestId));
    metadata.set('x-actor-category', 'SYSTEM');
    metadata.set('x-actor-id', SYSTEM_ACTOR_ID);
    for (const [key, value] of Object.entries({
      ...activePropagationHeaders(),
      ...propagationHeaders,
    })) {
      if (key === 'traceparent' || key === 'tracestate' || key === 'baggage')
        metadata.set(key, value);
    }
    const response = await firstValueFrom(
      this.client.getFulfillmentSnapshot({ bookingId, requestId }, metadata).pipe(timeout(5_000)),
    );
    if (!response.snapshot)
      throw namedError('BookingSnapshotMissing', 'Booking snapshot is missing.');
    return {
      ...response.snapshot,
      status: isCancelled(response.snapshot.status) ? 'CANCELLED' : 'ACTIVE',
    };
  }
}

function isCancelled(value: number | string): boolean {
  return value === 8 || value === 'BOOKING_STATUS_CANCELLED' || value === 'CANCELLED';
}

function namedError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

import { randomUUID } from 'node:crypto';

import type { PaymentAttemptedV1 } from '@bus/contracts-events';
import { activePropagationHeaders, createRequestId, currentTraceContext } from '@bus/observability';

import type { PersistPaymentAttemptInput } from './payment.types';

export interface PaymentEventDispatch {
  event: PaymentAttemptedV1;
  headers: Record<string, string>;
}

export function createPaymentAttemptedDispatch(
  attempt: PersistPaymentAttemptInput,
): PaymentEventDispatch {
  const event: PaymentAttemptedV1 = {
    eventId: randomUUID(),
    eventType: 'PaymentAttemptedV1',
    eventVersion: 1,
    occurredAt: attempt.createdAt,
    traceId: currentTraceContext().traceId ?? randomUUID().replaceAll('-', ''),
    requestId: createRequestId(attempt.requestId),
    producer: 'payment-service',
    aggregateId: attempt.bookingId,
    actorCategory: attempt.owner.type === 'GUEST_SESSION' ? 'GUEST' : 'CUSTOMER',
    ...(attempt.owner.type === 'GUEST_SESSION' && { checkoutSessionId: attempt.owner.id }),
    payload: {
      paymentAttemptId: attempt.id,
      bookingId: attempt.bookingId,
      requestedOutcome: attempt.requestedOutcome,
      status: attempt.status,
      amountVnd: attempt.amountVnd,
      ...(attempt.failureCode !== undefined && { failureCode: attempt.failureCode }),
    },
  };
  return {
    event,
    headers: {
      eventId: event.eventId,
      eventType: event.eventType,
      eventVersion: String(event.eventVersion),
      traceId: event.traceId,
      requestId: event.requestId,
      producer: event.producer,
      aggregateId: event.aggregateId,
      actorCategory: event.actorCategory,
      actorId: attempt.owner.id,
      ...activePropagationHeaders(),
    },
  };
}

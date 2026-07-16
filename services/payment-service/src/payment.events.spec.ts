import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createPaymentAttemptedDispatch } from './payment.events';

describe('payment event contracts', () => {
  it('emits a privacy-safe failed payment fact with correlation headers', () => {
    const ownerId = randomUUID();
    const dispatch = createPaymentAttemptedDispatch({
      id: randomUUID(),
      bookingId: randomUUID(),
      owner: { type: 'GUEST_SESSION', id: ownerId },
      amountVnd: 280000,
      requestedOutcome: 'FAILURE',
      idempotencyKey: randomUUID(),
      requestFingerprint: 'a'.repeat(64),
      status: 'FAILED',
      failureCode: 'SIMULATED_FAILURE',
      createdAt: '2030-06-20T00:02:00.000Z',
      requestId: 'request-payment-attempt',
    });

    expect(dispatch.event).toMatchObject({
      eventType: 'PaymentAttemptedV1',
      actorCategory: 'GUEST',
      checkoutSessionId: ownerId,
      payload: { status: 'FAILED', failureCode: 'SIMULATED_FAILURE', amountVnd: 280000 },
    });
    expect(dispatch.headers).toMatchObject({
      actorId: ownerId,
      requestId: 'request-payment-attempt',
    });
    expect(JSON.stringify(dispatch.event)).not.toMatch(/email|phone|holdToken|document/i);
  });
});

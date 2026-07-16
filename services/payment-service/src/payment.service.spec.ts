import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { PaymentValidationError, validatePaymentAttemptRequest } from './payment.service';

describe('PaymentService validation', () => {
  it('creates a stable fingerprint without accepting client-side payment metadata', () => {
    const request = {
      bookingId: randomUUID(),
      owner: { type: 'GUEST_SESSION' as const, id: randomUUID() },
      amountVnd: 280000,
      requestedOutcome: 'SUCCESS' as const,
      idempotencyKey: randomUUID(),
    };

    expect(validatePaymentAttemptRequest(request).requestFingerprint).toBe(
      validatePaymentAttemptRequest(request).requestFingerprint,
    );
  });

  it('rejects non-integer VND amounts', () => {
    expect(() =>
      validatePaymentAttemptRequest({
        bookingId: randomUUID(),
        owner: { type: 'GUEST_SESSION', id: randomUUID() },
        amountVnd: 12.5,
        requestedOutcome: 'SUCCESS',
        idempotencyKey: randomUUID(),
      }),
    ).toThrow(PaymentValidationError);
  });
});

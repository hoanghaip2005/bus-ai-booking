import { randomUUID } from 'node:crypto';

import { afterAll, describe, expect, it } from 'vitest';

import { PaymentDatabase } from './payment.database';
import { PaymentRepository } from './payment.repository';
import { PaymentIdempotencyConflictError, PaymentService } from './payment.service';

const database = new PaymentDatabase();
const repository = new PaymentRepository(database);
const service = new PaymentService(database, repository);
const bookingIds: string[] = [];

describe('PaymentService integration', () => {
  afterAll(async () => {
    if (bookingIds.length > 0) {
      await database.query(
        'DELETE FROM payment.outbox_events WHERE aggregate_id = ANY($1::uuid[])',
        [bookingIds],
      );
      await database.query('DELETE FROM payment.attempts WHERE booking_id = ANY($1::uuid[])', [
        bookingIds,
      ]);
    }
    await database.onModuleDestroy();
  });

  it('deduplicates concurrent successful attempts for one booking', async () => {
    const bookingId = trackBooking();
    const owner = { type: 'GUEST_SESSION' as const, id: randomUUID() };
    const first = paymentRequest(bookingId, owner, randomUUID(), 'SUCCESS');
    const second = paymentRequest(bookingId, owner, randomUUID(), 'SUCCESS');

    const [left, right] = await Promise.all([
      service.createPaymentAttempt(first),
      service.createPaymentAttempt(second),
    ]);

    expect(right.attempt.id).toBe(left.attempt.id);
    expect(left.attempt).toMatchObject({ status: 'SUCCEEDED', amountVnd: 280000 });
    const count = await database.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM payment.attempts
       WHERE booking_id = $1 AND status = 'SUCCEEDED'`,
      [bookingId],
    );
    expect(count.rows[0]?.count).toBe('1');
    const facts = await database.query<{
      event_type: string;
      payload: Record<string, unknown>;
    }>('SELECT event_type, payload FROM payment.outbox_events WHERE aggregate_id = $1', [
      bookingId,
    ]);
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0]?.event_type).toBe('PaymentAttemptedV1');
    expect(JSON.stringify(facts.rows[0]?.payload)).not.toMatch(/email|phone|holdToken|document/i);
  });

  it('replays the same request and rejects idempotency reuse for another outcome', async () => {
    const bookingId = trackBooking();
    const owner = { type: 'GUEST_SESSION' as const, id: randomUUID() };
    const key = randomUUID();
    const request = paymentRequest(bookingId, owner, key, 'FAILURE');

    const first = await service.createPaymentAttempt(request);
    const replay = await service.createPaymentAttempt(request);
    expect(replay.attempt.id).toBe(first.attempt.id);
    expect(first.attempt).toMatchObject({
      status: 'FAILED',
      failureCode: 'SIMULATED_FAILURE',
    });
    await expect(
      service.createPaymentAttempt(paymentRequest(bookingId, owner, key, 'SUCCESS')),
    ).rejects.toBeInstanceOf(PaymentIdempotencyConflictError);
  });
});

function trackBooking(): string {
  const bookingId = randomUUID();
  bookingIds.push(bookingId);
  return bookingId;
}

function paymentRequest(
  bookingId: string,
  owner: { type: 'GUEST_SESSION'; id: string },
  idempotencyKey: string,
  requestedOutcome: 'SUCCESS' | 'FAILURE',
) {
  return {
    bookingId,
    owner,
    amountVnd: 280000,
    requestedOutcome,
    idempotencyKey,
  };
}

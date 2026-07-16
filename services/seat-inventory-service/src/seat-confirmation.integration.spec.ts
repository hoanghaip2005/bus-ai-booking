import { randomUUID } from 'node:crypto';

import { createClient } from 'redis';
import { afterAll, describe, expect, it } from 'vitest';

import { SeatHoldStore, type ActiveSeatHold, type HoldOwner } from './seat-hold.store';
import { SeatInventoryDatabase } from './seat-inventory.database';
import { SeatInventoryService } from './seat-inventory.service';
import { SeatStateRepository } from './seat-state.repository';

const tripId = '00000000-0000-4000-8000-000000000702';
const namespace = `test:seat-confirmation:v1:${randomUUID()}`;
const eventChannel = `${namespace}:events`;
const database = new SeatInventoryDatabase();
const repository = new SeatStateRepository(database);
const store = new SeatHoldStore({ namespace, eventChannel, idempotencyTtlSeconds: 30 });
const service = new SeatInventoryService(database, {} as never, repository, store);
const redis = createClient({ url: 'redis://localhost:6379' });
const bookingIds: string[] = [];

describe('SeatInventoryService confirmation integration', () => {
  afterAll(async () => {
    if (bookingIds.length > 0) {
      await database.query(
        'DELETE FROM seat_inventory.trip_seat_states WHERE booking_id = ANY($1::uuid[])',
        [bookingIds],
      );
      await database.query(
        'DELETE FROM seat_inventory.confirmation_requests WHERE booking_id = ANY($1::uuid[])',
        [bookingIds],
      );
    }
    await store.onModuleDestroy();
    await database.onModuleDestroy();
    await redis.connect();
    const keys: string[] = [];
    for await (const batch of redis.scanIterator({ MATCH: `${namespace}:*` })) keys.push(...batch);
    if (keys.length > 0) await redis.del(keys);
    await redis.quit();
  });

  it('confirms all held seats once and replays after Redis state is consumed', async () => {
    const owner = createOwner();
    const bookingId = trackBooking();
    const hold = await acquireHold(owner, ['A08', 'A09']);
    const idempotencyKey = randomUUID();
    const request = confirmationRequest(hold, bookingId, idempotencyKey);

    const first = await service.confirmSeats(request);
    const replay = await service.confirmSeats(request);

    expect(replay.confirmedAt).toBe(first.confirmedAt);
    await expect(store.get(hold.token)).resolves.toBeNull();
    const states = await database.query<{ seat_id: string; booking_id: string }>(
      `SELECT seat_id, booking_id
       FROM seat_inventory.trip_seat_states
       WHERE trip_id = $1 AND seat_id = ANY($2::text[])
       ORDER BY seat_id`,
      [tripId, hold.seatIds],
    );
    expect(states.rows).toEqual([
      { seat_id: 'A08', booking_id: bookingId },
      { seat_id: 'A09', booking_id: bookingId },
    ]);
  });

  it('allows exactly one booking to win concurrent confirmation of one held seat', async () => {
    const owner = createOwner();
    const hold = await acquireHold(owner, ['A10']);
    const leftBookingId = trackBooking();
    const rightBookingId = trackBooking();

    const results = await Promise.allSettled([
      service.confirmSeats(confirmationRequest(hold, leftBookingId, randomUUID())),
      service.confirmSeats(confirmationRequest(hold, rightBookingId, randomUUID())),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const state = await database.query<{ booking_id: string }>(
      `SELECT booking_id
       FROM seat_inventory.trip_seat_states
       WHERE trip_id = $1 AND seat_id = 'A10'`,
      [tripId],
    );
    expect([leftBookingId, rightBookingId]).toContain(state.rows[0]?.booking_id);
  });
});

async function acquireHold(owner: HoldOwner, seatIds: string[]): Promise<ActiveSeatHold> {
  const hold: ActiveSeatHold = {
    token: randomUUID(),
    tripId,
    seatIds,
    owner,
    idempotencyKey: randomUUID(),
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
    unitPriceVnd: 220000,
    totalPriceVnd: 220000 * seatIds.length,
  };
  const acquired = await store.acquire(hold, randomUUID().replaceAll('-', ''), 30);
  expect(acquired.status).toBe('ACQUIRED');
  return hold;
}

function confirmationRequest(hold: ActiveSeatHold, bookingId: string, idempotencyKey: string) {
  return {
    holdToken: hold.token,
    owner: hold.owner,
    tripId: hold.tripId,
    seatIds: hold.seatIds,
    bookingId,
    idempotencyKey,
  };
}

function createOwner(): HoldOwner {
  return { type: 'GUEST_SESSION', id: randomUUID() };
}

function trackBooking(): string {
  const bookingId = randomUUID();
  bookingIds.push(bookingId);
  return bookingId;
}

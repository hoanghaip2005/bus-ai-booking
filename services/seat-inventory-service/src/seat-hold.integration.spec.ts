import { randomUUID } from 'node:crypto';

import type { SeatStatusChangedV1 } from '@bus/contracts-events';
import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SeatHoldStore } from './seat-hold.store';
import { SeatInventoryDatabase } from './seat-inventory.database';
import { SeatInventoryService } from './seat-inventory.service';
import { SeatStateRepository } from './seat-state.repository';

const tripId = randomUUID();
const seededBookingId = randomUUID();
const owner = { type: 'GUEST_SESSION' as const, id: randomUUID() };
const namespace = `test:seat-hold:v1:${randomUUID()}`;
const eventChannel = `${namespace}:events`;
const database = new SeatInventoryDatabase();
const holdStore = new SeatHoldStore({ namespace, eventChannel, idempotencyTtlSeconds: 30 });
const service = new SeatInventoryService(
  database,
  {
    getTripLayout: async () => ({
      tripId,
      layoutId: '00000000-0000-4000-8000-000000000902',
      layoutVersion: 1,
      layoutName: 'Sleeper 34',
      deckCount: 1,
      priceVnd: 280_000,
      seats: Array.from({ length: 10 }, (_, index) => {
        const id = `A${String(index + 1).padStart(2, '0')}`;
        return { id, label: id, deck: 1, row: index + 1, column: 1 };
      }),
    }),
  } as never,
  new SeatStateRepository(database),
  holdStore,
);

describe('SeatInventoryService Redis hold lifecycle', () => {
  beforeAll(async () => {
    await database.query(
      `INSERT INTO seat_inventory.trip_seat_states
         (trip_id, seat_id, status, booking_id, reason, updated_by_actor)
       VALUES ($1, 'A01', 'BOOKED', $2, NULL, 'seat-hold-integration'),
              ($1, 'A02', 'BLOCKED', NULL, 'Integration maintenance', 'seat-hold-integration')`,
      [tripId, seededBookingId],
    );
  });

  afterAll(async () => {
    await database.query('DELETE FROM seat_inventory.trip_seat_states WHERE trip_id = $1', [
      tripId,
    ]);
    await holdStore.onModuleDestroy();
    await database.onModuleDestroy();
    const cleanupClient = createClient({ url: 'redis://localhost:6379' });
    await cleanupClient.connect();
    const keys: string[] = [];
    for await (const batch of cleanupClient.scanIterator({ MATCH: `${namespace}:*` })) {
      keys.push(...batch);
    }
    if (keys.length > 0) await cleanupClient.del(keys);
    await cleanupClient.quit();
  });

  it('holds an available seat and restores it for the same owner', async () => {
    const response = await service.holdSeats({
      tripId,
      seatIds: ['A03'],
      owner,
      idempotencyKey: randomUUID(),
      requestedTtlSeconds: 30,
      requestId: 'request-hold-tracer',
    });

    expect(response.hold).toMatchObject({
      tripId,
      seatIds: ['A03'],
      owner,
      status: 'ACTIVE',
      unitPriceVnd: 280_000,
      totalPriceVnd: 280_000,
    });
    await expect(service.getHold({ holdToken: response.hold.token, owner })).resolves.toMatchObject(
      { hold: { token: response.hold.token, status: 'ACTIVE' } },
    );
    const seatMap = await service.getSeatMap({ tripId, holdToken: response.hold.token });
    expect(seatMap.seatMap.seats.find((seat) => seat.id === 'A03')).toMatchObject({
      status: 'HELD',
      heldByRequester: true,
    });
  });

  it('seat-race allows exactly one of 100 owners to hold the same seat', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 100 }, () =>
        service.holdSeats({
          tripId,
          seatIds: ['A04'],
          owner: { type: 'GUEST_SESSION', id: randomUUID() },
          idempotencyKey: randomUUID(),
          requestedTtlSeconds: 30,
        }),
      ),
    );

    const winners = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const conflicts = attempts.filter(
      (attempt) => attempt.status === 'rejected' && attempt.reason?.name === 'SeatUnavailableError',
    );
    expect(winners).toHaveLength(1);
    expect(conflicts).toHaveLength(99);
  });

  it('acquires multiple seats all-or-nothing when one requested seat is busy', async () => {
    await service.holdSeats({
      tripId,
      seatIds: ['A06'],
      owner,
      idempotencyKey: randomUUID(),
      requestedTtlSeconds: 30,
    });

    await expect(
      service.holdSeats({
        tripId,
        seatIds: ['A05', 'A06'],
        owner: { type: 'GUEST_SESSION', id: randomUUID() },
        idempotencyKey: randomUUID(),
        requestedTtlSeconds: 30,
      }),
    ).rejects.toMatchObject({ name: 'SeatUnavailableError' });

    const seatMap = await service.getSeatMap({ tripId });
    expect(seatMap.seatMap.seats.find((seat) => seat.id === 'A05')?.status).toBe('AVAILABLE');
    expect(seatMap.seatMap.seats.find((seat) => seat.id === 'A06')?.status).toBe('HELD');
  });

  it('lets durable BOOKED and BLOCKED states override stale Redis holds', async () => {
    const token = randomUUID();
    await holdStore.acquire(
      {
        token,
        tripId,
        seatIds: ['A01'],
        owner,
        idempotencyKey: randomUUID(),
        expiresAt: new Date(Date.now() + 30_000).toISOString(),
        unitPriceVnd: 280_000,
        totalPriceVnd: 280_000,
      },
      randomUUID(),
      30,
    );

    const seatMap = await service.getSeatMap({ tripId, holdToken: token });
    expect(seatMap.seatMap.seats.find((seat) => seat.id === 'A01')).toMatchObject({
      status: 'BOOKED',
      heldByRequester: false,
    });
    expect(seatMap.seatMap.seats.find((seat) => seat.id === 'A02')).toMatchObject({
      status: 'BLOCKED',
      heldByRequester: false,
    });
    await expect(
      service.holdSeats({
        tripId,
        seatIds: ['A02'],
        owner,
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toMatchObject({ name: 'SeatUnavailableError' });
  });

  it('replays the same idempotent hold and rejects reuse for a different request', async () => {
    const idempotencyKey = randomUUID();
    const first = await service.holdSeats({
      tripId,
      seatIds: ['A08'],
      owner,
      idempotencyKey,
      requestedTtlSeconds: 30,
    });
    const replay = await service.holdSeats({
      tripId,
      seatIds: ['A08'],
      owner,
      idempotencyKey,
      requestedTtlSeconds: 30,
    });

    expect(replay.hold.token).toBe(first.hold.token);
    await expect(
      service.holdSeats({
        tripId,
        seatIds: ['A09'],
        owner,
        idempotencyKey,
        requestedTtlSeconds: 30,
      }),
    ).rejects.toMatchObject({ name: 'IdempotencyConflictError' });
    const seatMap = await service.getSeatMap({ tripId });
    expect(seatMap.seatMap.seats.find((seat) => seat.id === 'A09')?.status).toBe('AVAILABLE');
  });

  it('sweeps an expired hold, publishes AVAILABLE, and exposes no checkout secret', async () => {
    const subscriber = createClient({ url: 'redis://localhost:6379' });
    const events: SeatStatusChangedV1[] = [];
    await subscriber.connect();
    await subscriber.subscribe(eventChannel, (message) => {
      events.push(JSON.parse(message) as SeatStatusChangedV1);
    });

    const response = await service.holdSeats({
      tripId,
      seatIds: ['A10'],
      owner,
      idempotencyKey: randomUUID(),
      requestedTtlSeconds: 1,
    });

    await waitFor(() => events.some((event) => event.status === 'HELD'));

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    await holdStore.sweepExpired();
    await waitFor(() => events.some((event) => event.status === 'AVAILABLE'));

    await expect(service.getHold({ holdToken: response.hold.token, owner })).rejects.toMatchObject({
      name: 'HoldExpiredError',
    });
    const seatMap = await service.getSeatMap({ tripId, holdToken: response.hold.token });
    expect(seatMap.seatMap.seats.find((seat) => seat.id === 'A10')).toMatchObject({
      status: 'AVAILABLE',
      heldByRequester: false,
    });

    const heldEvent = events.find((event) => event.status === 'HELD');
    const availableEvent = events.find((event) => event.status === 'AVAILABLE');
    expect(heldEvent).toMatchObject({ tripId, seatIds: ['A10'], status: 'HELD' });
    expect(availableEvent).toMatchObject({ tripId, seatIds: ['A10'], status: 'AVAILABLE' });
    expect(availableEvent?.version).toBeGreaterThan(heldEvent?.version ?? 0);
    expect(JSON.stringify(events)).not.toMatch(/token|owner|checkout/i);
    await subscriber.quit();
  });

  it('releases only for the matching owner and remains idempotent', async () => {
    const subscriber = createClient({ url: 'redis://localhost:6379' });
    const events: SeatStatusChangedV1[] = [];
    await subscriber.connect();
    await subscriber.subscribe(eventChannel, (message) => {
      const event = JSON.parse(message) as SeatStatusChangedV1;
      if (event.seatIds.includes('A07')) events.push(event);
    });

    try {
      const response = await service.holdSeats({
        tripId,
        seatIds: ['A07'],
        owner,
        idempotencyKey: randomUUID(),
        requestedTtlSeconds: 30,
      });
      await waitFor(() => events.some((event) => event.status === 'HELD'));
      const wrongOwner = await service.releaseHold({
        holdToken: response.hold.token,
        owner: { type: 'GUEST_SESSION', id: randomUUID() },
        idempotencyKey: randomUUID(),
      });
      expect(wrongOwner.released).toBe(false);
      expect(events.filter((event) => event.status === 'AVAILABLE')).toHaveLength(0);
      expect(
        (await service.getSeatMap({ tripId })).seatMap.seats.find((seat) => seat.id === 'A07'),
      ).toMatchObject({ status: 'HELD' });

      const releaseRequest = {
        holdToken: response.hold.token,
        owner,
        idempotencyKey: randomUUID(),
        requestId: 'release-hold-idempotent-request',
      };
      const released = await service.releaseHold(releaseRequest);
      await waitFor(() => events.some((event) => event.status === 'AVAILABLE'));
      expect(released).toMatchObject({ released: true, tripId, seatIds: ['A07'] });
      expect(
        (await service.getSeatMap({ tripId })).seatMap.seats.find((seat) => seat.id === 'A07'),
      ).toMatchObject({ status: 'AVAILABLE' });
      await expect(service.releaseHold(releaseRequest)).resolves.toEqual(released);
      expect(events.filter((event) => event.status === 'AVAILABLE')).toHaveLength(1);

      const secondHold = await service.holdSeats({
        tripId,
        seatIds: ['A07'],
        owner,
        idempotencyKey: randomUUID(),
        requestedTtlSeconds: 30,
      });
      await expect(
        service.releaseHold({
          ...releaseRequest,
          holdToken: secondHold.hold.token,
        }),
      ).rejects.toMatchObject({ name: 'IdempotencyConflictError' });
      expect(
        (await service.getSeatMap({ tripId })).seatMap.seats.find((seat) => seat.id === 'A07'),
      ).toMatchObject({ status: 'HELD' });
      await service.releaseHold({
        holdToken: secondHold.hold.token,
        owner,
        idempotencyKey: randomUUID(),
      });
    } finally {
      await subscriber.quit();
    }
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for Redis seat event.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SeatInventoryDatabase } from './seat-inventory.database';
import { SeatStateRepository } from './seat-state.repository';

const database = new SeatInventoryDatabase();
const repository = new SeatStateRepository(database);
const tripId = randomUUID();
const seededBookingId = randomUUID();

describe('SeatStateRepository', () => {
  beforeAll(async () => {
    await database.query(
      `INSERT INTO seat_inventory.trip_seat_states
         (trip_id, seat_id, status, booking_id, reason, updated_by_actor)
       VALUES ($1, 'A01', 'BOOKED', $2, NULL, 'seat-state-integration'),
              ($1, 'A02', 'BLOCKED', NULL, 'Integration maintenance', 'seat-state-integration')`,
      [tripId, seededBookingId],
    );
  });

  afterAll(async () => {
    await database.query('DELETE FROM seat_inventory.trip_seat_states WHERE trip_id = $1', [
      tripId,
    ]);
    await database.onModuleDestroy();
  });

  it('reads only durable BOOKED and BLOCKED states owned by Seat Inventory', async () => {
    await expect(repository.listByTrip(tripId)).resolves.toEqual([
      { seatId: 'A01', status: 'BOOKED' },
      { seatId: 'A02', status: 'BLOCKED' },
    ]);
  });

  it('returns no durable rows for a trip without sold or blocked seats', async () => {
    await expect(repository.listByTrip(randomUUID())).resolves.toEqual([]);
  });

  it('blocks and unblocks a seat idempotently while preserving audit correlation', async () => {
    const actorId = randomUUID();
    const base = {
      tripId,
      seatIds: ['A03'],
      actorId,
      reason: 'Integration maintenance',
      requestId: 'seat-block-integration-request',
      traceId: 'seat-block-integration-trace',
      updatedAt: '2030-06-20T00:00:00.000Z',
    };
    try {
      const blocked = await repository.setSeatBlocked({
        ...base,
        blocked: true,
        idempotencyKey: 'seat-block-integration-001',
        requestFingerprint: 'a'.repeat(64),
      });
      await expect(
        repository.setSeatBlocked({
          ...base,
          blocked: true,
          idempotencyKey: 'seat-block-integration-001',
          requestFingerprint: 'a'.repeat(64),
        }),
      ).resolves.toEqual(blocked);
      await expect(repository.listByTrip(tripId)).resolves.toContainEqual({
        seatId: 'A03',
        status: 'BLOCKED',
      });

      await expect(
        repository.setSeatBlocked({
          ...base,
          blocked: false,
          reason: 'UNBLOCKED',
          idempotencyKey: 'seat-block-integration-002',
          requestFingerprint: 'b'.repeat(64),
        }),
      ).resolves.toMatchObject({ blocked: false, changed: true });
      await expect(repository.listByTrip(tripId)).resolves.not.toContainEqual({
        seatId: 'A03',
        status: 'BLOCKED',
      });
    } finally {
      await database.query('DELETE FROM seat_inventory.seat_block_commands WHERE actor_id = $1', [
        actorId,
      ]);
      await database.query(
        `DELETE FROM seat_inventory.trip_seat_states
          WHERE trip_id = $1 AND seat_id = 'A03' AND status = 'BLOCKED'`,
        [tripId],
      );
    }
  });
});

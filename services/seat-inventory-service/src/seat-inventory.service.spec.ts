import { describe, expect, it, vi } from 'vitest';

import { SeatInventoryService } from './seat-inventory.service';

const database = { ping: async () => undefined };
const layout = {
  tripId: '00000000-0000-4000-8000-000000000701',
  layoutId: '00000000-0000-4000-8000-000000000902',
  layoutVersion: 1,
  layoutName: 'Sleeper 34',
  deckCount: 2,
  priceVnd: 280000,
  seats: [
    { id: 'A01', label: 'A01', deck: 1, row: 1, column: 1 },
    { id: 'A02', label: 'A02', deck: 1, row: 1, column: 2 },
    { id: 'A03', label: 'A03', deck: 1, row: 1, column: 4 },
  ],
};

describe('SeatInventoryService', () => {
  it('derives AVAILABLE while durable BOOKED and BLOCKED states override it', async () => {
    const service = new SeatInventoryService(
      database as never,
      { getTripLayout: async () => layout } as never,
      {
        listByTrip: async () => [
          { seatId: 'A01', status: 'BOOKED' },
          { seatId: 'A02', status: 'BLOCKED' },
        ],
      } as never,
      { getSeatHolds: async () => new Map() } as never,
    );

    await expect(
      service.getSeatMap({ tripId: '00000000-0000-4000-8000-000000000701' }),
    ).resolves.toMatchObject({
      seatMap: {
        layoutVersion: 1,
        seats: [
          { id: 'A01', status: 'BOOKED' },
          { id: 'A02', status: 'BLOCKED' },
          { id: 'A03', status: 'AVAILABLE' },
        ],
      },
    });
  });

  it('checks PostgreSQL and Catalog before reporting readiness', async () => {
    const ping = vi.fn(async () => undefined);
    const readiness = vi.fn(async () => undefined);
    const redisPing = vi.fn(async () => undefined);
    const service = new SeatInventoryService(
      { ping } as never,
      { readiness } as never,
      { listByTrip: async () => [] } as never,
      { ping: redisPing } as never,
    );

    await expect(service.readiness({ requestId: 'req-ready' })).resolves.toMatchObject({
      status: 'UP',
      requestId: 'req-ready',
    });
    expect(ping).toHaveBeenCalledOnce();
    expect(readiness).toHaveBeenCalledWith('req-ready');
    expect(redisPing).toHaveBeenCalledOnce();
  });

  it('rejects invalid trip IDs before calling dependencies', async () => {
    const getTripLayout = vi.fn();
    const listByTrip = vi.fn();
    const service = new SeatInventoryService(
      database as never,
      { getTripLayout } as never,
      { listByTrip } as never,
      { getSeatHolds: vi.fn() } as never,
    );

    await expect(service.getSeatMap({ tripId: 'not-a-uuid' })).rejects.toMatchObject({
      name: 'SeatMapValidationError',
      code: 'VALIDATION_ERROR',
    });
    expect(getTripLayout).not.toHaveBeenCalled();
    expect(listByTrip).not.toHaveBeenCalled();
  });

  it('confirms an exact active hold durably before consuming Redis state', async () => {
    const confirmSeats = vi.fn(async (input: { requestFingerprint: string }) => ({
      requestFingerprint: input.requestFingerprint,
      confirmedAt: '2030-06-20T00:02:00.000Z',
    }));
    const consumeConfirmedHold = vi.fn(async () => ({ status: 'CONSUMED' as const }));
    const service = new SeatInventoryService(
      database as never,
      {} as never,
      { findConfirmation: async () => null, confirmSeats } as never,
      {
        get: async () => ({
          token: 'hold-token-1234567890',
          tripId: '00000000-0000-4000-8000-000000000701',
          seatIds: ['A03'],
          owner: {
            type: 'GUEST_SESSION',
            id: '00000000-0000-4000-8000-000000000902',
          },
          idempotencyKey: 'hold-idempotency-123',
          expiresAt: '2030-06-20T00:05:00.000Z',
          unitPriceVnd: 280000,
          totalPriceVnd: 280000,
        }),
        consumeConfirmedHold,
      } as never,
    );

    await expect(
      service.confirmSeats({
        holdToken: 'hold-token-1234567890',
        owner: {
          type: 'GUEST_SESSION',
          id: '00000000-0000-4000-8000-000000000902',
        },
        tripId: '00000000-0000-4000-8000-000000000701',
        seatIds: ['A03'],
        bookingId: '00000000-0000-4000-8000-000000001101',
        idempotencyKey: 'confirm-idempotency-123',
      }),
    ).resolves.toMatchObject({ confirmed: true, seatIds: ['A03'] });
    expect(confirmSeats).toHaveBeenCalledOnce();
    expect(consumeConfirmedHold).toHaveBeenCalledOnce();
    expect(confirmSeats.mock.invocationCallOrder[0]).toBeLessThan(
      consumeConfirmedHold.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('releases durable booked seats before publishing AVAILABLE notification', async () => {
    const releaseBookedSeats = vi.fn(async (input: { requestFingerprint: string }) => ({
      idempotencyKey: 'cancel-idempotency-123',
      requestFingerprint: input.requestFingerprint,
      releasedAt: '2030-06-20T01:00:00.000Z',
    }));
    const publishAvailableSeats = vi.fn(async () => undefined);
    const service = new SeatInventoryService(
      database as never,
      {} as never,
      { releaseBookedSeats } as never,
      { publishAvailableSeats } as never,
    );

    await expect(
      service.releaseBookedSeats({
        bookingId: '00000000-0000-4000-8000-000000001101',
        tripId: '00000000-0000-4000-8000-000000000701',
        seatIds: ['A03'],
        idempotencyKey: 'cancel-idempotency-123',
      }),
    ).resolves.toMatchObject({ released: true, seatIds: ['A03'] });
    expect(releaseBookedSeats.mock.invocationCallOrder[0]).toBeLessThan(
      publishAvailableSeats.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('commits an ADMIN seat block before publishing BLOCKED', async () => {
    const setSeatBlocked = vi.fn(async (input: { requestFingerprint: string }) => ({
      tripId: layout.tripId,
      seatIds: ['A03'],
      blocked: true,
      changed: true,
      requestFingerprint: input.requestFingerprint,
      updatedAt: '2030-06-20T01:00:00.000Z',
    }));
    const publishBlockedSeats = vi.fn(async () => undefined);
    const service = new SeatInventoryService(
      database as never,
      { getTripLayout: async () => layout } as never,
      { setSeatBlocked } as never,
      { publishBlockedSeats } as never,
    );

    await expect(
      service.setSeatBlocked({
        tripId: layout.tripId,
        seatIds: ['A03'],
        blocked: true,
        reason: 'Maintenance',
        idempotencyKey: 'seat-block-command-123',
        actor: { id: '00000000-0000-4000-8000-000000001403', role: 'ADMIN' },
      }),
    ).resolves.toMatchObject({ blocked: true, changed: true, seatIds: ['A03'] });
    expect(setSeatBlocked.mock.invocationCallOrder[0]).toBeLessThan(
      publishBlockedSeats.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('rejects seat blocking without an ADMIN actor', async () => {
    const service = new SeatInventoryService(
      database as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.setSeatBlocked({
        tripId: layout.tripId,
        seatIds: ['A03'],
        blocked: true,
        reason: 'Maintenance',
        idempotencyKey: 'seat-block-command-456',
      }),
    ).rejects.toMatchObject({ name: 'SeatAdminForbiddenError' });
  });
});

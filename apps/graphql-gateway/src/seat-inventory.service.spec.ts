import type { ClientGrpc } from '@nestjs/microservices';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { SeatInventoryGatewayService } from './seat-inventory.service';

describe('SeatInventoryGatewayService', () => {
  it('normalizes omitted repeated seats', async () => {
    const grpcClient = {
      getService: () => ({
        getSeatMap: (input: { tripId: string; requestId: string }) =>
          of({
            seatMap: {
              tripId: input.tripId,
              layoutId: 'layout-1',
              layoutVersion: 1,
              layoutName: 'Sleeper 34',
              deckCount: 2,
              generatedAt: '2030-06-20T00:00:00.000Z',
            },
            requestId: input.requestId,
          }),
      }),
    } as unknown as ClientGrpc;
    const service = new SeatInventoryGatewayService(grpcClient);
    service.onModuleInit();

    await expect(
      service.getSeatMap('00000000-0000-4000-8000-000000000701', null, 'request-seat'),
    ).resolves.toMatchObject({ seatMap: { seats: [] }, requestId: 'request-seat' });
  });

  it('maps gRPC NOT_FOUND without exposing hidden trip state', async () => {
    const grpcClient = {
      getService: () => ({ getSeatMap: () => throwError(() => ({ code: 5 })) }),
    } as unknown as ClientGrpc;
    const service = new SeatInventoryGatewayService(grpcClient);
    service.onModuleInit();

    await expect(service.getSeatMap('00000000-0000-4000-8000-000000000799')).rejects.toMatchObject({
      name: 'SeatMapNotFoundError',
    });
  });

  it('forwards hold commands with the checkout owner and idempotency key', async () => {
    const holdSeats = vi.fn((input) =>
      of({
        hold: {
          token: 'hold-token-1234567890',
          tripId: input.tripId,
          seatIds: input.seatIds,
          expiresAt: '2030-06-20T00:05:00.000Z',
          remainingTtlSeconds: 300,
          unitPriceVnd: 280000,
          totalPriceVnd: 280000,
          status: 1,
        },
        requestId: input.requestId,
      }),
    );
    const grpcClient = {
      getService: () => ({ holdSeats }),
    } as unknown as ClientGrpc;
    const service = new SeatInventoryGatewayService(grpcClient);
    service.onModuleInit();

    await expect(
      service.holdSeats(
        {
          tripId: '00000000-0000-4000-8000-000000000701',
          seatIds: ['A03'],
          owner: { type: 'GUEST_SESSION', id: '00000000-0000-4000-8000-000000000902' },
          idempotencyKey: '00000000-0000-4000-8000-000000000903',
          requestedTtlSeconds: 300,
        },
        'request-hold',
      ),
    ).resolves.toMatchObject({ hold: { token: 'hold-token-1234567890', seatIds: ['A03'] } });
    expect(holdSeats).toHaveBeenCalledWith(
      expect.objectContaining({
        owner: { type: 1, id: '00000000-0000-4000-8000-000000000902' },
        idempotencyKey: '00000000-0000-4000-8000-000000000903',
      }),
      expect.anything(),
    );
  });

  it('looks up and releases holds for the same checkout owner', async () => {
    const getHold = vi.fn((input) =>
      of({
        hold: {
          token: input.holdToken,
          tripId: '00000000-0000-4000-8000-000000000701',
          seatIds: ['A03'],
          expiresAt: '2030-06-20T00:05:00.000Z',
          remainingTtlSeconds: 250,
          unitPriceVnd: 280000,
          totalPriceVnd: 280000,
          status: 1,
        },
        requestId: input.requestId,
      }),
    );
    const releaseHold = vi.fn((input) =>
      of({
        released: true,
        tripId: '00000000-0000-4000-8000-000000000701',
        seatIds: ['A03'],
        releasedAt: '2030-06-20T00:01:00.000Z',
        requestId: input.requestId,
      }),
    );
    const grpcClient = {
      getService: () => ({ getHold, releaseHold }),
    } as unknown as ClientGrpc;
    const service = new SeatInventoryGatewayService(grpcClient);
    service.onModuleInit();
    const owner = { type: 'GUEST_SESSION' as const, id: '00000000-0000-4000-8000-000000000902' };

    await expect(
      service.getHold('hold-token-1234567890', owner, 'request-get-hold'),
    ).resolves.toMatchObject({ hold: { seatIds: ['A03'] } });
    await expect(
      service.releaseHold(
        'hold-token-1234567890',
        owner,
        '00000000-0000-4000-8000-000000000904',
        'request-release',
      ),
    ).resolves.toMatchObject({ released: true, seatIds: ['A03'] });
    expect(releaseHold).toHaveBeenCalledWith(
      expect.objectContaining({ owner: { type: 1, id: owner.id } }),
      expect.anything(),
    );
  });
});

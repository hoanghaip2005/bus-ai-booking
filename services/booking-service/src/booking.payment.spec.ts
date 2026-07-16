import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { BookingService } from './booking.service';
import type { BookingPaymentRecord, BookingView, CheckoutOwner } from './booking.types';

describe('BookingService simulated payment', () => {
  it('keeps the booking pending and does not confirm seats on simulated failure', async () => {
    const record = paymentRecord();
    const confirmSeats = vi.fn();
    const markPaid = vi.fn();
    const service = paymentService(record, {
      confirmSeats,
      markPaid,
      createPaymentAttempt: async () => ({
        id: randomUUID(),
        status: 'FAILED',
        amountVnd: record.booking.totalPriceVnd,
        failureCode: 'SIMULATED_FAILURE',
        createdAt: new Date().toISOString(),
      }),
    });

    await expect(
      service.simulatePayment(paymentRequest(record.booking.id, 'FAILURE')),
    ).resolves.toMatchObject({
      result: { status: 'FAILED', booking: { status: 'PENDING_PAYMENT' } },
    });
    expect(confirmSeats).not.toHaveBeenCalled();
    expect(markPaid).not.toHaveBeenCalled();
  });

  it('confirms seats before committing PAID', async () => {
    const record = paymentRecord();
    const attemptId = randomUUID();
    const paymentKey = randomUUID();
    const confirmSeats = vi.fn(async () => new Date().toISOString());
    const markPaid = vi.fn(async () => ({
      ...record,
      booking: { ...record.booking, status: 'PAID' as const },
      paidPaymentAttemptId: attemptId,
      paymentIdempotencyKey: paymentKey,
      paidAt: new Date().toISOString(),
    }));
    const service = paymentService(record, {
      confirmSeats,
      markPaid,
      createPaymentAttempt: async () => ({
        id: attemptId,
        status: 'SUCCEEDED',
        amountVnd: record.booking.totalPriceVnd,
        createdAt: new Date().toISOString(),
      }),
    });

    await expect(
      service.simulatePayment(paymentRequest(record.booking.id, 'SUCCESS', paymentKey)),
    ).resolves.toMatchObject({
      result: { status: 'SUCCEEDED', booking: { status: 'PAID' } },
    });
    expect(confirmSeats).toHaveBeenCalledOnce();
    expect(markPaid).toHaveBeenCalledOnce();
    expect(confirmSeats.mock.invocationCallOrder[0]).toBeLessThan(
      markPaid.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

function paymentService(
  record: BookingPaymentRecord,
  overrides: {
    confirmSeats: ReturnType<typeof vi.fn>;
    markPaid: ReturnType<typeof vi.fn>;
    createPaymentAttempt: (input: unknown) => Promise<{
      id: string;
      status: 'SUCCEEDED' | 'FAILED';
      amountVnd: number;
      failureCode?: string;
      createdAt: string;
    }>;
  },
): BookingService {
  return new BookingService(
    {
      withPaymentCommandLock: async (_bookingId: string, operation: () => Promise<unknown>) =>
        operation(),
    } as never,
    {
      findOwnedById: async () => record,
      markPaid: overrides.markPaid,
    } as never,
    {
      confirmSeats: overrides.confirmSeats,
    } as never,
    {} as never,
    {
      createPaymentAttempt: overrides.createPaymentAttempt,
    } as never,
  );
}

function paymentRequest(bookingId: string, outcome: 'SUCCESS' | 'FAILURE', key = randomUUID()) {
  return {
    bookingId,
    owner,
    outcome,
    idempotencyKey: key,
  };
}

const owner: CheckoutOwner = { type: 'GUEST_SESSION', id: randomUUID() };

function paymentRecord(): BookingPaymentRecord {
  const booking: BookingView = {
    id: randomUUID(),
    bookingCode: 'BV-2030-ABC1234567',
    status: 'PENDING_PAYMENT',
    trip: {
      tripId: '00000000-0000-4000-8000-000000000702',
      routeId: '00000000-0000-4000-8000-000000000501',
      routeCode: 'HCM-DLI',
      operatorName: 'Phuong Trang Demo',
      vehicleTypeName: 'Limousine 22',
      vehicleCode: 'PT-L22-01',
      vehiclePlate: '51B-220.01',
      originName: 'TP.HCM',
      destinationName: 'Đà Lạt',
      pickupName: 'Bến xe Miền Đông',
      dropoffName: 'Bến xe Liên tỉnh Đà Lạt',
      departureAt: '2030-06-20T01:00:00.000Z',
      arrivalAt: '2030-06-20T07:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      unitPriceVnd: 220000,
    },
    contact: {
      fullName: 'Nguyen Van An',
      email: 'an@example.com',
      phone: '0901234567',
    },
    passengers: [
      {
        id: randomUUID(),
        seatId: 'A03',
        fullName: 'Nguyen Van An',
        hasDocumentNumber: false,
      },
    ],
    totalPriceVnd: 220000,
    holdExpiresAt: new Date(Date.now() + 300_000).toISOString(),
    createdAt: new Date().toISOString(),
  };
  return { booking, holdToken: 'hold-token-1234567890' };
}

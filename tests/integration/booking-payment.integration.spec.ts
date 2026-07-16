import { randomUUID } from 'node:crypto';

import { createClient } from 'redis';
import { afterAll, describe, expect, it } from 'vitest';

import { PaymentDatabase } from '../../services/payment-service/src/payment.database';
import { PaymentRepository } from '../../services/payment-service/src/payment.repository';
import { PaymentService } from '../../services/payment-service/src/payment.service';
import {
  SeatHoldStore,
  type ActiveSeatHold,
  type HoldOwner,
} from '../../services/seat-inventory-service/src/seat-hold.store';
import { SeatInventoryDatabase } from '../../services/seat-inventory-service/src/seat-inventory.database';
import {
  SeatInventoryService,
  SeatUnavailableError,
} from '../../services/seat-inventory-service/src/seat-inventory.service';
import { SeatStateRepository } from '../../services/seat-inventory-service/src/seat-state.repository';
import { BookingDatabase } from '../../services/booking-service/src/booking.database';
import { BookingRepository } from '../../services/booking-service/src/booking.repository';
import {
  BookingInvalidStateTransitionError,
  BookingPaymentForbiddenError,
  BookingService,
} from '../../services/booking-service/src/booking.service';
import type { CheckoutOwner } from '../../services/booking-service/src/booking.types';
import { BookingHoldExpiredError } from '../../services/booking-service/src/seat-inventory.client';

const tripId = '00000000-0000-4000-8000-000000000702';
const namespace = `test:booking-payment:v1:${randomUUID()}`;
const eventChannel = `${namespace}:events`;
const bookingDatabase = new BookingDatabase();
const bookingRepository = new BookingRepository(bookingDatabase);
const paymentDatabase = new PaymentDatabase();
const paymentService = new PaymentService(paymentDatabase, new PaymentRepository(paymentDatabase));
const seatDatabase = new SeatInventoryDatabase();
const seatRepository = new SeatStateRepository(seatDatabase);
const holdStore = new SeatHoldStore({ namespace, eventChannel, idempotencyTtlSeconds: 30 });
const seatService = new SeatInventoryService(
  seatDatabase,
  {
    getTripLayout: async () => ({
      tripId,
      layoutId: randomUUID(),
      layoutVersion: 1,
      layoutName: 'Limousine 22',
      deckCount: 1,
      priceVnd: 220000,
      seats: ['A11', 'A12', 'A13', 'A14'].map((id, index) => ({
        id,
        label: id,
        deck: 1,
        row: 1,
        column: index + 1,
      })),
    }),
  } as never,
  seatRepository,
  holdStore,
);
const bookingService = new BookingService(
  bookingDatabase,
  bookingRepository,
  {
    getActiveHold: async (holdToken: string, owner: CheckoutOwner) =>
      (await seatService.getHold({ holdToken, owner })).hold,
    confirmSeats: async (input: Parameters<SeatInventoryService['confirmSeats']>[0]) =>
      (await seatService.confirmSeats(input)).confirmedAt,
    releaseHold: async (holdToken: string, owner: CheckoutOwner, idempotencyKey: string) => {
      await seatService.releaseHold({ holdToken, owner, idempotencyKey });
    },
    releaseBookedSeats: async (input: Parameters<SeatInventoryService['releaseBookedSeats']>[0]) =>
      (await seatService.releaseBookedSeats(input)).releasedAt,
  } as never,
  {
    getBookingSnapshot: async () => ({
      tripId,
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
      catalogPriceVnd: 220000,
    }),
  } as never,
  {
    createPaymentAttempt: async (input: {
      bookingId: string;
      owner: CheckoutOwner;
      amountVnd: number;
      outcome: 'SUCCESS' | 'FAILURE';
      idempotencyKey: string;
    }) =>
      (
        await paymentService.createPaymentAttempt({
          bookingId: input.bookingId,
          owner: input.owner,
          amountVnd: input.amountVnd,
          requestedOutcome: input.outcome,
          idempotencyKey: input.idempotencyKey,
        })
      ).attempt,
  } as never,
);
const redis = createClient({ url: 'redis://localhost:6379' });
const bookingIds: string[] = [];

describe('Booking payment orchestration integration', () => {
  afterAll(async () => {
    if (bookingIds.length > 0) {
      await bookingDatabase.query(
        'DELETE FROM booking.outbox_events WHERE aggregate_id = ANY($1::uuid[])',
        [bookingIds],
      );
      await paymentDatabase.query(
        'DELETE FROM payment.outbox_events WHERE aggregate_id = ANY($1::uuid[])',
        [bookingIds],
      );
      await seatDatabase.query(
        'DELETE FROM seat_inventory.trip_seat_states WHERE booking_id = ANY($1::uuid[])',
        [bookingIds],
      );
      await seatDatabase.query(
        'DELETE FROM seat_inventory.confirmation_requests WHERE booking_id = ANY($1::uuid[])',
        [bookingIds],
      );
      await seatDatabase.query(
        'DELETE FROM seat_inventory.release_requests WHERE booking_id = ANY($1::uuid[])',
        [bookingIds],
      );
      await paymentDatabase.query(
        'DELETE FROM payment.attempts WHERE booking_id = ANY($1::uuid[])',
        [bookingIds],
      );
      await bookingDatabase.query('DELETE FROM booking.bookings WHERE id = ANY($1::uuid[])', [
        bookingIds,
      ]);
    }
    await holdStore.onModuleDestroy();
    await Promise.all([
      seatDatabase.onModuleDestroy(),
      paymentDatabase.onModuleDestroy(),
      bookingDatabase.onModuleDestroy(),
    ]);
    await redis.connect();
    const keys: string[] = [];
    for await (const batch of redis.scanIterator({ MATCH: `${namespace}:*` })) keys.push(...batch);
    if (keys.length > 0) await redis.del(keys);
    await redis.quit();
  });

  it('keeps failed payment retryable, then confirms seats before PAID exactly once', async () => {
    const owner = createOwner();
    const hold = await acquireHold(owner, ['A11'], 30);
    const booking = await createBooking(owner, hold);
    const failure = await bookingService.simulatePayment({
      bookingId: booking.id,
      owner,
      outcome: 'FAILURE',
      idempotencyKey: randomUUID(),
    });
    expect(failure.result).toMatchObject({
      status: 'FAILED',
      booking: { status: 'PENDING_PAYMENT' },
    });
    const pendingSeats = await seatDatabase.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM seat_inventory.trip_seat_states WHERE booking_id = $1',
      [booking.id],
    );
    expect(pendingSeats.rows[0]?.count).toBe('0');

    const paymentKey = randomUUID();
    const [first, replay] = await Promise.all([
      bookingService.simulatePayment({
        bookingId: booking.id,
        owner,
        outcome: 'SUCCESS',
        idempotencyKey: paymentKey,
      }),
      bookingService.simulatePayment({
        bookingId: booking.id,
        owner,
        outcome: 'SUCCESS',
        idempotencyKey: paymentKey,
      }),
    ]);
    expect(replay.result.paymentAttemptId).toBe(first.result.paymentAttemptId);
    expect(first.result.booking.status).toBe('PAID');
    const sold = await seatDatabase.query<{ booking_id: string }>(
      `SELECT booking_id
       FROM seat_inventory.trip_seat_states
       WHERE trip_id = $1 AND seat_id = 'A11'`,
      [tripId],
    );
    expect(sold.rows[0]?.booking_id).toBe(booking.id);
    const paidHistory = await bookingDatabase.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM booking.status_history
       WHERE booking_id = $1 AND to_status = 'PAID'`,
      [booking.id],
    );
    expect(paidHistory.rows[0]?.count).toBe('1');
    const paidOutbox = await bookingDatabase.query<{
      destination: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT destination, event_type, payload
       FROM booking.outbox_events
       WHERE aggregate_id = $1 AND event_type = 'BookingPaidV1'
       ORDER BY destination`,
      [booking.id],
    );
    expect(paidOutbox.rows.map((row) => row.destination)).toEqual(['KAFKA', 'RABBITMQ']);
    expect(JSON.stringify(paidOutbox.rows)).not.toMatch(
      /example\.com|0901234567|holdToken|document/i,
    );
    await expect(
      seatService.holdSeats({
        tripId,
        seatIds: ['A11'],
        owner: createOwner(),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SeatUnavailableError);
  });

  it('transitions an expired booking once without creating a payment attempt', async () => {
    const owner = createOwner();
    const hold = await acquireHold(owner, ['A12'], 1);
    const booking = await createBooking(owner, hold);
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await expect(
      bookingService.simulatePayment({
        bookingId: booking.id,
        owner,
        outcome: 'SUCCESS',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(BookingHoldExpiredError);
    const persisted = await bookingDatabase.query<{ status: string }>(
      'SELECT status FROM booking.bookings WHERE id = $1',
      [booking.id],
    );
    expect(persisted.rows[0]?.status).toBe('EXPIRED');
    const attempts = await paymentDatabase.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM payment.attempts WHERE booking_id = $1',
      [booking.id],
    );
    expect(attempts.rows[0]?.count).toBe('0');
    const expiredOutbox = await bookingDatabase.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM booking.outbox_events
       WHERE aggregate_id = $1 AND event_type = 'BookingExpiredV1'`,
      [booking.id],
    );
    expect(expiredOutbox.rows[0]?.count).toBe('2');
  });

  it('cancels an owned paid booking once, releases seats and writes both outbox targets', async () => {
    const owner = { type: 'CUSTOMER' as const, id: randomUUID() };
    const hold = await acquireHold(owner, ['A12'], 30);
    const booking = await createBooking(owner, hold);
    await bookingService.simulatePayment({
      bookingId: booking.id,
      owner,
      outcome: 'SUCCESS',
      idempotencyKey: randomUUID(),
    });

    await expect(
      bookingService.cancelBooking({
        bookingId: booking.id,
        customerId: randomUUID(),
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(BookingPaymentForbiddenError);

    const cancellationKey = randomUUID();
    const first = await bookingService.cancelBooking({
      bookingId: booking.id,
      customerId: owner.id,
      idempotencyKey: cancellationKey,
    });
    const replay = await bookingService.cancelBooking({
      bookingId: booking.id,
      customerId: owner.id,
      idempotencyKey: cancellationKey,
    });

    expect(first.result).toMatchObject({
      booking: { status: 'CANCELLED' },
      policyCode: 'BEFORE_DEPARTURE_FULL_RELEASE',
      seatsReleased: true,
    });
    expect(replay.result.cancelledAt).toBe(first.result.cancelledAt);
    const seat = await seatDatabase.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM seat_inventory.trip_seat_states
       WHERE booking_id = $1`,
      [booking.id],
    );
    expect(seat.rows[0]?.count).toBe('0');
    const history = await bookingDatabase.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM booking.status_history
       WHERE booking_id = $1 AND to_status = 'CANCELLED'`,
      [booking.id],
    );
    expect(history.rows[0]?.count).toBe('1');
    const outbox = await bookingDatabase.query<{ destination: string }>(
      `SELECT destination
       FROM booking.outbox_events
       WHERE aggregate_id = $1 AND event_type = 'BookingCancelledV1'
       ORDER BY destination`,
      [booking.id],
    );
    expect(outbox.rows.map((row) => row.destination)).toEqual(['KAFKA', 'RABBITMQ']);
    const nextOwner = createOwner();
    const nextHold = await seatService.holdSeats({
      tripId,
      seatIds: ['A12'],
      owner: nextOwner,
      idempotencyKey: randomUUID(),
    });
    expect(nextHold).toMatchObject({ hold: { seatIds: ['A12'] } });
    await seatService.releaseHold({
      holdToken: nextHold.hold.token,
      owner: nextOwner,
      idempotencyKey: randomUUID(),
    });
  });

  it('reconciles expired bookings in the background exactly once', async () => {
    const owner = createOwner();
    const hold = await acquireHold(owner, ['A14'], 1);
    const booking = await createBooking(owner, hold);
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await bookingService.reconcileExpiredBookings();
    await bookingService.reconcileExpiredBookings();

    const persisted = await bookingDatabase.query<{ status: string }>(
      'SELECT status FROM booking.bookings WHERE id = $1',
      [booking.id],
    );
    expect(persisted.rows[0]?.status).toBe('EXPIRED');
    const history = await bookingDatabase.query<{ count: string; actor_type: string }>(
      `SELECT count(*)::text AS count, max(actor_type) AS actor_type
       FROM booking.status_history
       WHERE booking_id = $1 AND to_status = 'EXPIRED'`,
      [booking.id],
    );
    expect(history.rows[0]).toMatchObject({ count: '1', actor_type: 'SYSTEM' });
    const outbox = await bookingDatabase.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM booking.outbox_events
       WHERE aggregate_id = $1 AND event_type = 'BookingExpiredV1'`,
      [booking.id],
    );
    expect(outbox.rows[0]?.count).toBe('2');
    await expect(holdStore.get(hold.token)).resolves.toBeNull();
  });

  it('serializes expiry behind an in-flight durable seat confirmation', async () => {
    const owner = createOwner();
    const hold = await acquireHold(owner, ['A13'], 1);
    const booking = await createBooking(owner, hold);
    let releaseConfirmedSeat!: () => void;
    const confirmedSeatCanReturn = new Promise<void>((resolve) => {
      releaseConfirmedSeat = resolve;
    });
    let reportDurableConfirmation!: () => void;
    const durableConfirmation = new Promise<void>((resolve) => {
      reportDurableConfirmation = resolve;
    });
    const delayedService = new BookingService(
      bookingDatabase,
      bookingRepository,
      {
        getActiveHold: async (holdToken: string, checkoutOwner: CheckoutOwner) =>
          (await seatService.getHold({ holdToken, owner: checkoutOwner })).hold,
        confirmSeats: async (input: Parameters<SeatInventoryService['confirmSeats']>[0]) => {
          const response = await seatService.confirmSeats(input);
          reportDurableConfirmation();
          await confirmedSeatCanReturn;
          return response.confirmedAt;
        },
        releaseHold: async (
          holdToken: string,
          checkoutOwner: CheckoutOwner,
          idempotencyKey: string,
        ) => {
          await seatService.releaseHold({
            holdToken,
            owner: checkoutOwner,
            idempotencyKey,
          });
        },
        releaseBookedSeats: async (
          input: Parameters<SeatInventoryService['releaseBookedSeats']>[0],
        ) => (await seatService.releaseBookedSeats(input)).releasedAt,
      } as never,
      {
        getBookingSnapshot: async () => {
          throw new Error('Catalog is not used during payment.');
        },
      } as never,
      {
        createPaymentAttempt: async (input: {
          bookingId: string;
          owner: CheckoutOwner;
          amountVnd: number;
          outcome: 'SUCCESS' | 'FAILURE';
          idempotencyKey: string;
        }) =>
          (
            await paymentService.createPaymentAttempt({
              bookingId: input.bookingId,
              owner: input.owner,
              amountVnd: input.amountVnd,
              requestedOutcome: input.outcome,
              idempotencyKey: input.idempotencyKey,
            })
          ).attempt,
      } as never,
    );

    const success = delayedService.simulatePayment({
      bookingId: booking.id,
      owner,
      outcome: 'SUCCESS',
      idempotencyKey: randomUUID(),
    });
    await durableConfirmation;
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const expiry = delayedService.simulatePayment({
      bookingId: booking.id,
      owner,
      outcome: 'FAILURE',
      idempotencyKey: randomUUID(),
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    releaseConfirmedSeat();

    await expect(success).resolves.toMatchObject({ result: { booking: { status: 'PAID' } } });
    await expect(expiry).rejects.toBeInstanceOf(BookingInvalidStateTransitionError);
    const persisted = await bookingDatabase.query<{ status: string }>(
      'SELECT status FROM booking.bookings WHERE id = $1',
      [booking.id],
    );
    expect(persisted.rows[0]?.status).toBe('PAID');
    const sold = await seatDatabase.query<{ booking_id: string }>(
      `SELECT booking_id
       FROM seat_inventory.trip_seat_states
       WHERE trip_id = $1 AND seat_id = 'A13'`,
      [tripId],
    );
    expect(sold.rows[0]?.booking_id).toBe(booking.id);
  });
});

async function acquireHold(
  owner: HoldOwner,
  seatIds: string[],
  ttlSeconds: number,
): Promise<ActiveSeatHold> {
  const hold: ActiveSeatHold = {
    token: randomUUID(),
    tripId,
    seatIds,
    owner,
    idempotencyKey: randomUUID(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
    unitPriceVnd: 220000,
    totalPriceVnd: 220000 * seatIds.length,
  };
  const acquired = await holdStore.acquire(hold, randomUUID().replaceAll('-', ''), ttlSeconds);
  expect(acquired.status).toBe('ACQUIRED');
  return hold;
}

async function createBooking(owner: CheckoutOwner, hold: ActiveSeatHold) {
  const response = await bookingService.createBooking({
    holdToken: hold.token,
    owner,
    idempotencyKey: randomUUID(),
    contact: {
      fullName: 'Payment Integration Guest',
      email: 'payment.integration@example.com',
      phone: '0901234567',
    },
    passengers: hold.seatIds.map((seatId) => ({
      seatId,
      fullName: `Passenger ${seatId}`,
    })),
  });
  bookingIds.push(response.booking.id);
  return response.booking;
}

function createOwner(): CheckoutOwner {
  return { type: 'GUEST_SESSION', id: randomUUID() };
}

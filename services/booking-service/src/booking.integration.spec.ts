import { randomUUID } from 'node:crypto';

import { createClient } from 'redis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BookingDatabase } from './booking.database';
import { BookingRepository } from './booking.repository';
import {
  BookingIdempotencyConflictError,
  BookingService,
  BookingWrongTripError,
} from './booking.service';
import type { CheckoutOwner } from './booking.types';
import type { CatalogClient } from './catalog.client';
import {
  BookingHoldExpiredError,
  BookingHoldForbiddenError,
  type SeatInventoryClient,
} from './seat-inventory.client';

const tripId = '00000000-0000-4000-8000-000000000702';
const namespace = `test:booking:v1:${randomUUID()}`;
const redis = createClient({ url: 'redis://localhost:6379' });
const bookingDatabase = new BookingDatabase();
const bookingRepository = new BookingRepository(bookingDatabase);
const owners: CheckoutOwner[] = [];

const bookingService = new BookingService(
  bookingDatabase,
  bookingRepository,
  {
    getActiveHold: async (holdToken: string, owner: CheckoutOwner) => {
      const serialized = await redis.get(`${namespace}:hold:${holdToken}`);
      if (!serialized) throw new BookingHoldExpiredError();
      const hold = JSON.parse(serialized) as TestHold;
      if (hold.owner.type !== owner.type || hold.owner.id !== owner.id) {
        throw new BookingHoldForbiddenError();
      }
      return hold;
    },
  } as unknown as SeatInventoryClient,
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
      unitPriceVnd: 220_000,
      catalogPriceVnd: 220_000,
    }),
  } as unknown as CatalogClient,
  { readiness: async () => undefined } as never,
);

describe('BookingService guest booking integration', () => {
  beforeAll(async () => {
    await redis.connect();
  });

  afterAll(async () => {
    for (const owner of owners) {
      await bookingDatabase.query(
        `DELETE FROM booking.operational_audit
         WHERE target_id IN (
           SELECT id FROM booking.bookings WHERE checkout_owner_id = $1
           UNION
           SELECT ticket.ticket_id FROM booking.issued_ticket_refs AS ticket
           JOIN booking.bookings AS booking ON booking.id = ticket.booking_id
           WHERE booking.checkout_owner_id = $1
         )`,
        [owner.id],
      );
      await bookingDatabase.query(
        `DELETE FROM booking.outbox_events
         WHERE aggregate_id IN (
           SELECT id FROM booking.bookings WHERE checkout_owner_id = $1
         )`,
        [owner.id],
      );
      await bookingDatabase.query('DELETE FROM booking.bookings WHERE checkout_owner_id = $1', [
        owner.id,
      ]);
    }
    await bookingDatabase.onModuleDestroy();
    const keys: string[] = [];
    for await (const batch of redis.scanIterator({ MATCH: `${namespace}:*` })) {
      keys.push(...batch);
    }
    if (keys.length > 0) await redis.del(keys);
    await redis.quit();
  });

  it('creates one PENDING_PAYMENT booking under concurrent idempotent retries', async () => {
    const owner = createOwner();
    const hold = await createHold(owner, ['A01'], 30);
    const idempotencyKey = randomUUID();
    const request = bookingRequest(owner, hold.token, idempotencyKey, ['A01']);

    const [first, replay] = await Promise.all([
      bookingService.createBooking(request),
      bookingService.createBooking(request),
    ]);

    expect(replay.booking.id).toBe(first.booking.id);
    expect(first.booking).toMatchObject({
      status: 'PENDING_PAYMENT',
      totalPriceVnd: 220_000,
      passengers: [{ seatId: 'A01', hasDocumentNumber: true }],
    });
    const bookingCount = await bookingDatabase.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM booking.bookings WHERE checkout_owner_id = $1',
      [owner.id],
    );
    expect(bookingCount.rows[0]?.count).toBe('1');
    const passengerPrivacy = await bookingDatabase.query<{
      document_number_hash: string | null;
    }>('SELECT document_number_hash FROM booking.passengers WHERE booking_id = $1', [
      first.booking.id,
    ]);
    expect(passengerPrivacy.rows[0]?.document_number_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(passengerPrivacy.rows[0]?.document_number_hash).not.toContain('ABC123456');

    await expect(redis.get(`${namespace}:hold:${hold.token}`)).resolves.not.toBeNull();
    const soldState = await bookingDatabase.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM seat_inventory.trip_seat_states
       WHERE booking_id = $1`,
      [first.booking.id],
    );
    expect(soldState.rows[0]?.count).toBe('0');
    const outbox = await bookingDatabase.query<{
      destination: string;
      event_type: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT destination, event_type, payload
       FROM booking.outbox_events
       WHERE aggregate_id = $1`,
      [first.booking.id],
    );
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({
      destination: 'KAFKA',
      event_type: 'BookingCreatedV1',
    });
    expect(JSON.stringify(outbox.rows[0]?.payload)).not.toMatch(
      /an@example\.com|0901234567|hold-token|document/i,
    );

    await expect(
      bookingService.createBooking({
        ...request,
        contact: { ...request.contact, email: 'different@example.com' },
      }),
    ).rejects.toBeInstanceOf(BookingIdempotencyConflictError);
  });

  it('rejects passenger mappings that do not cover the hold exactly', async () => {
    const owner = createOwner();
    const hold = await createHold(owner, ['A02'], 30);

    await expect(
      bookingService.createBooking(bookingRequest(owner, hold.token, randomUUID(), ['A03'])),
    ).rejects.toMatchObject({ name: 'BookingValidationError' });
  });

  it('looks up a guest booking only when code and normalized email both match', async () => {
    const owner = createOwner();
    const hold = await createHold(owner, ['A04'], 30);
    const created = await bookingService.createBooking(
      bookingRequest(owner, hold.token, randomUUID(), ['A04']),
    );

    await expect(
      bookingService.getGuestBookingLookup({
        bookingCode: created.booking.bookingCode,
        normalizedEmail: ' AN@EXAMPLE.COM ',
      }),
    ).resolves.toMatchObject({
      booking: {
        bookingCode: created.booking.bookingCode,
        status: 'PENDING_PAYMENT',
        seatIds: ['A04'],
        ticketIssued: false,
        cancellationEligible: false,
      },
    });
    await expect(
      bookingService.getGuestBookingLookup({
        bookingCode: created.booking.bookingCode,
        normalizedEmail: 'wrong@example.com',
      }),
    ).rejects.toMatchObject({ name: 'BookingLookupNotFoundError' });
  });

  it('rejects expired and wrong-owner holds without creating a booking', async () => {
    const owner = createOwner();
    const expiredHold = await createHold(owner, ['A03'], 1);
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    await expect(
      bookingService.createBooking(bookingRequest(owner, expiredHold.token, randomUUID(), ['A03'])),
    ).rejects.toBeInstanceOf(BookingHoldExpiredError);

    const activeHold = await createHold(owner, ['A05'], 30);
    const otherOwner = createOwner();
    await expect(
      bookingService.createBooking(
        bookingRequest(otherOwner, activeHold.token, randomUUID(), ['A05']),
      ),
    ).rejects.toBeInstanceOf(BookingHoldForbiddenError);
  });

  it('returns stable paginated history for only the authenticated customer owner', async () => {
    const customer = createOwner('CUSTOMER');
    const otherCustomer = createOwner('CUSTOMER');
    for (const [index, seatId] of ['A06', 'A07', 'A08'].entries()) {
      const hold = await createHold(customer, [seatId], 30);
      await bookingService.createBooking(
        bookingRequest(customer, hold.token, randomUUID(), [seatId]),
      );
      if (index === 0) {
        const otherHold = await createHold(otherCustomer, ['A09'], 30);
        await bookingService.createBooking(
          bookingRequest(otherCustomer, otherHold.token, randomUUID(), ['A09']),
        );
      }
    }

    const first = await bookingService.listMyBookings({ customerId: customer.id, pageSize: 2 });
    const second = await bookingService.listMyBookings({
      customerId: customer.id,
      pageSize: 2,
      cursor: first.nextCursor,
    });

    expect(first.bookings).toHaveLength(2);
    expect(first.nextCursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(second.bookings).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.bookings, ...second.bookings].map((booking) => booking.id)).size).toBe(
      3,
    );
    expect(
      [...first.bookings, ...second.bookings].every(
        (booking) => booking.contact.email === 'an@example.com',
      ),
    ).toBe(true);
  });

  it('registers issued tickets and checks in one passenger idempotently', async () => {
    const owner = createOwner();
    const hold = await createHold(owner, ['A10'], 30);
    const created = await bookingService.createBooking(
      bookingRequest(owner, hold.token, randomUUID(), ['A10']),
    );
    const issuedAt = new Date().toISOString();
    await bookingDatabase.query(
      `UPDATE booking.bookings
       SET status = 'PAID', paid_at = $2, updated_at = $2,
           paid_payment_attempt_id = $3, payment_idempotency_key = $4
       WHERE id = $1`,
      [created.booking.id, issuedAt, randomUUID(), 'ticket-check-in-payment-seed'],
    );
    const passenger = created.booking.passengers[0]!;
    const ticketId = randomUUID();
    const ticketCode = `VT-2030-CHECKIN-${passenger.seatId}`;
    const qrPayload = `${created.booking.bookingCode}-${ticketId}`;
    await bookingService.markTicketIssued({
      bookingId: created.booking.id,
      sourceEventId: randomUUID(),
      issuedAt,
      ticketCount: 1,
      tickets: [{ ticketId, passengerId: passenger.id, ticketCode, qrPayload }],
    });

    const actor = { id: randomUUID(), role: 'STAFF' as const };
    await expect(
      bookingService.staffTicketLookup({
        kind: 'BOOKING_CODE',
        credential: created.booking.bookingCode,
        actor,
      }),
    ).resolves.toMatchObject({
      tickets: [{ ticketCode, passengerName: passenger.fullName, seatId: 'A10' }],
    });
    await expect(
      bookingService.checkInTicket({
        kind: 'TICKET_CODE',
        credential: ticketCode,
        tripId: '00000000-0000-4000-8000-000000000799',
        idempotencyKey: 'ticket-check-in-wrong-trip',
        actor,
      }),
    ).rejects.toBeInstanceOf(BookingWrongTripError);

    const command = {
      kind: 'QR_PAYLOAD' as const,
      credential: qrPayload,
      tripId,
      idempotencyKey: 'ticket-check-in-integration-001',
      actor,
      requestId: 'request-check-in',
    };
    const [first, replay] = await Promise.all([
      bookingService.checkInTicket(command),
      bookingService.checkInTicket(command),
    ]);
    expect(first).toMatchObject({
      transitioned: true,
      ticket: { checkedInAt: expect.any(String) },
    });
    expect(replay).toEqual(first);

    await expect(
      bookingService.checkInTicket({
        ...command,
        idempotencyKey: 'ticket-check-in-integration-002',
      }),
    ).resolves.toMatchObject({ transitioned: false });
    const persisted = await bookingDatabase.query<{
      status: string;
      check_in_count: string;
      actor_id: string;
    }>(
      `SELECT booking.status,
              (SELECT count(*)::text FROM booking.ticket_check_ins WHERE booking_id = booking.id)
                AS check_in_count,
              (SELECT actor_id::text FROM booking.ticket_check_ins
                WHERE booking_id = booking.id LIMIT 1) AS actor_id
       FROM booking.bookings AS booking WHERE booking.id = $1`,
      [created.booking.id],
    );
    expect(persisted.rows[0]).toEqual({
      status: 'CHECKED_IN',
      check_in_count: '1',
      actor_id: actor.id,
    });

    const operations = await bookingService.getAdminOperations({
      tripId,
      bookingLimit: 100,
      auditLimit: 100,
      actor: { id: randomUUID(), role: 'ADMIN' },
      requestId: 'request-admin-operations',
    });
    expect(operations.bookings).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: created.booking.id })]),
    );
    expect(operations.summary).toMatchObject({
      bookingCount: expect.any(Number),
      passengerCount: expect.any(Number),
      revenueVnd: expect.any(Number),
    });
    expect(operations.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'TICKET_CHECKED_IN',
          targetId: ticketId,
          actorId: actor.id,
          requestId: 'request-check-in',
        }),
      ]),
    );
  });
});

function createOwner(type: CheckoutOwner['type'] = 'GUEST_SESSION'): CheckoutOwner {
  const owner = { type, id: randomUUID() };
  owners.push(owner);
  return owner;
}

async function createHold(
  owner: CheckoutOwner,
  seatIds: string[],
  ttlSeconds: number,
): Promise<TestHold> {
  const hold: TestHold = {
    token: randomUUID(),
    tripId,
    seatIds,
    owner,
    expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
    unitPriceVnd: 220_000,
    totalPriceVnd: 220_000 * seatIds.length,
  };
  await redis.set(`${namespace}:hold:${hold.token}`, JSON.stringify(hold), { EX: ttlSeconds });
  return hold;
}

function bookingRequest(
  owner: CheckoutOwner,
  holdToken: string,
  idempotencyKey: string,
  seatIds: string[],
) {
  return {
    holdToken,
    owner,
    idempotencyKey,
    contact: {
      fullName: 'Nguyen Van An',
      email: 'an@example.com',
      phone: '0901234567',
    },
    passengers: seatIds.map((seatId) => ({
      seatId,
      fullName: `Passenger ${seatId}`,
      documentNumber: 'ABC123456',
    })),
  };
}

interface TestHold {
  token: string;
  tripId: string;
  seatIds: string[];
  owner: CheckoutOwner;
  expiresAt: string;
  unitPriceVnd: number;
  totalPriceVnd: number;
}

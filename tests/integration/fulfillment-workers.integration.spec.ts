import { randomUUID } from 'node:crypto';

import { bookingDomainExchange, type BookingPaidV1 } from '../../packages/contracts-events/src';
import { parseBookingPaidV1, RabbitWorkflowConsumer } from '../../packages/worker-runtime/src';
import { connect, type Channel, type ChannelModel } from 'amqplib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { NotificationDatabase } from '../../services/notification-worker/src/notification.database';
import { NotificationRepository } from '../../services/notification-worker/src/notification.repository';
import { NotificationService } from '../../services/notification-worker/src/notification.service';
import { TicketDatabase } from '../../services/ticket-worker/src/ticket.database';
import { TicketGenerator } from '../../services/ticket-worker/src/ticket.generator';
import { TicketRepository } from '../../services/ticket-worker/src/ticket.repository';
import { TicketService } from '../../services/ticket-worker/src/ticket.service';
import type { FulfillmentSnapshot } from '../../services/ticket-worker/src/ticket.types';

const ticketDatabase = new TicketDatabase();
const notificationDatabase = new NotificationDatabase();
const bookingId = randomUUID();
const cancelledBookingId = randomUUID();
const snapshot = fulfillmentSnapshot(bookingId);
const event = bookingPaidEvent(bookingId);
const markTicketIssued = vi.fn(async () => undefined);
const ticketService = new TicketService(
  new TicketRepository(ticketDatabase),
  new TicketGenerator(),
  { getSnapshot: async () => snapshot, markTicketIssued } as never,
);
const notificationService = new NotificationService(
  new NotificationRepository(notificationDatabase),
  {
    getRecipient: async () => ({
      bookingId,
      bookingCode: snapshot.bookingCode,
      contactEmail: snapshot.contactEmail,
    }),
  } as never,
);
const suffix = randomUUID();
const bookingPaidRoutingKey = `booking.paid.v1.test.${suffix}`;
const ticketQueue = `test.ticket.booking-paid.${suffix}`;
const notificationQueue = `test.notification.booking-paid.${suffix}`;
const ticketExchange = `test.ticket.worker.${suffix}`;
const notificationExchange = `test.notification.worker.${suffix}`;
let connection: ChannelModel;
let channel: Channel;
let ticketConsumer: RabbitWorkflowConsumer<BookingPaidV1>;
let notificationConsumer: RabbitWorkflowConsumer<BookingPaidV1>;

describe.sequential('fulfillment workers integration', () => {
  beforeAll(async () => {
    connection = await connect(
      process.env.RABBITMQ_URL ?? 'amqp://bus:bus_local_password@localhost:5672',
    );
    channel = await connection.createChannel();
    ticketConsumer = new RabbitWorkflowConsumer({
      service: 'ticket-worker-test',
      queueName: ticketQueue,
      bindingKey: bookingPaidRoutingKey,
      workerExchange: ticketExchange,
      maxAttempts: 3,
      retryDelayMs: 100,
      prefetch: 1,
      parse: parseBookingPaidV1,
      handle: ({ event: paid, headers }) => ticketService.processBookingPaid(paid, headers),
    });
    notificationConsumer = new RabbitWorkflowConsumer({
      service: 'notification-worker-test',
      queueName: notificationQueue,
      bindingKey: bookingPaidRoutingKey,
      workerExchange: notificationExchange,
      maxAttempts: 3,
      retryDelayMs: 100,
      prefetch: 1,
      parse: parseBookingPaidV1,
      handle: ({ event: paid, headers }) => notificationService.processBookingPaid(paid, headers),
    });
    await Promise.all([ticketConsumer.start(), notificationConsumer.start()]);
  });

  afterAll(async () => {
    await Promise.all([ticketConsumer.close(), notificationConsumer.close()]);
    await ticketDatabase.query('DELETE FROM ticket.inbox_events WHERE booking_id = $1', [
      bookingId,
    ]);
    await ticketDatabase.query('DELETE FROM ticket.inbox_events WHERE booking_id = $1', [
      cancelledBookingId,
    ]);
    await ticketDatabase.query('DELETE FROM ticket.tickets WHERE booking_id = $1', [bookingId]);
    await notificationDatabase.query(
      'DELETE FROM notification.inbox_events WHERE booking_id = $1',
      [bookingId],
    );
    await notificationDatabase.query(
      'DELETE FROM notification.inbox_events WHERE booking_id = $1',
      [cancelledBookingId],
    );
    await notificationDatabase.query(
      'DELETE FROM notification.email_delivery_logs WHERE booking_id = $1',
      [bookingId],
    );
    for (const queue of [
      ticketQueue,
      `${ticketQueue}.retry`,
      `${ticketQueue}.dlq`,
      notificationQueue,
      `${notificationQueue}.retry`,
      `${notificationQueue}.dlq`,
    ]) {
      await channel.deleteQueue(queue).catch(() => undefined);
    }
    await channel.deleteExchange(ticketExchange).catch(() => undefined);
    await channel.deleteExchange(notificationExchange).catch(() => undefined);
    await channel.close();
    await connection.close();
    await Promise.all([ticketDatabase.onModuleDestroy(), notificationDatabase.onModuleDestroy()]);
  }, 30_000);

  it('fulfillment workers fan out one paid event into tickets and one simulated email', async () => {
    await publish(event);
    await waitFor(async () => {
      const [ticketCount, emailCount] = await Promise.all([
        ticketDatabase.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM ticket.tickets WHERE booking_id = $1',
          [bookingId],
        ),
        notificationDatabase.query<{ count: string }>(
          'SELECT count(*)::text AS count FROM notification.email_delivery_logs WHERE booking_id = $1',
          [bookingId],
        ),
      ]);
      return (
        ticketCount.rows[0]?.count === '2' &&
        emailCount.rows[0]?.count === '1' &&
        markTicketIssued.mock.calls.length === 1
      );
    });

    const tickets = await ticketDatabase.query<{
      passenger_name: string;
      html_content: string;
      pdf_document: Buffer;
      qr_payload: string;
    }>(
      `SELECT passenger_name, html_content, pdf_document, qr_payload
       FROM ticket.tickets WHERE booking_id = $1 ORDER BY seat_id`,
      [bookingId],
    );
    expect(tickets.rows.map((ticket) => ticket.passenger_name)).toEqual([
      'Nguyễn Văn An',
      'Trần Thị Bình',
    ]);
    expect(tickets.rows.every((ticket) => ticket.html_content.includes('Vé điện tử'))).toBe(true);
    expect(
      tickets.rows.every((ticket) => ticket.pdf_document.subarray(0, 5).toString() === '%PDF-'),
    ).toBe(true);
    expect(tickets.rows.every((ticket) => ticket.qr_payload.startsWith(snapshot.bookingCode))).toBe(
      true,
    );
    expect(markTicketIssued).toHaveBeenCalledOnce();

    await publish(event);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const counts = await ticketDatabase.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM ticket.tickets WHERE booking_id = $1',
      [bookingId],
    );
    const emails = await notificationDatabase.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM notification.email_delivery_logs WHERE booking_id = $1',
      [bookingId],
    );
    expect(counts.rows[0]?.count).toBe('2');
    expect(emails.rows[0]?.count).toBe('1');
    expect(markTicketIssued).toHaveBeenCalledOnce();
  });

  it('fulfillment workers retry poison messages and park them in a RabbitMQ DLQ', async () => {
    const poisonQueue = `test.poison.booking-paid.${randomUUID()}`;
    const poisonExchange = `test.poison.worker.${randomUUID()}`;
    const poisonRoutingKey = `booking.paid.poison.${randomUUID()}`;
    const poisonConsumer = new RabbitWorkflowConsumer<BookingPaidV1>({
      service: 'poison-worker-test',
      queueName: poisonQueue,
      bindingKey: poisonRoutingKey,
      workerExchange: poisonExchange,
      maxAttempts: 2,
      retryDelayMs: 100,
      prefetch: 1,
      parse: parseBookingPaidV1,
      handle: async () => {
        const error = new Error('Poison message.');
        error.name = 'PoisonTicketError';
        throw error;
      },
    });
    await poisonConsumer.start();
    try {
      await channel.assertExchange(bookingDomainExchange, 'topic', { durable: true });
      channel.publish(bookingDomainExchange, poisonRoutingKey, Buffer.from(JSON.stringify(event)), {
        persistent: true,
        contentType: 'application/json',
        messageId: event.eventId,
        type: event.eventType,
        headers: eventHeaders(event),
      });
      const deadLetter = await waitForMessage(`${poisonQueue}.dlq`);
      expect(deadLetter.properties.headers?.['x-retry-count']).toBe('2');
      expect(deadLetter.properties.headers?.['x-last-error-code']).toBe('PoisonTicketError');
      channel.ack(deadLetter);
    } finally {
      await poisonConsumer.close();
      for (const queue of [poisonQueue, `${poisonQueue}.retry`, `${poisonQueue}.dlq`]) {
        await channel.deleteQueue(queue).catch(() => undefined);
      }
      await channel.deleteExchange(poisonExchange).catch(() => undefined);
    }
  });

  it('skips a paid event when the booking was cancelled before fulfillment', async () => {
    const cancelledSnapshot = {
      ...fulfillmentSnapshot(cancelledBookingId),
      status: 'CANCELLED' as const,
    };
    const cancelledEvent = bookingPaidEvent(cancelledBookingId);
    const markCancelledTicket = vi.fn(async () => undefined);
    const cancelledTicketService = new TicketService(
      new TicketRepository(ticketDatabase),
      new TicketGenerator(),
      {
        getSnapshot: async () => cancelledSnapshot,
        markTicketIssued: markCancelledTicket,
      } as never,
    );
    const cancelledNotificationService = new NotificationService(
      new NotificationRepository(notificationDatabase),
      {
        getRecipient: async () => ({
          bookingId: cancelledBookingId,
          bookingCode: cancelledSnapshot.bookingCode,
          contactEmail: cancelledSnapshot.contactEmail,
          status: 'CANCELLED',
        }),
      } as never,
    );

    await cancelledTicketService.processBookingPaid(cancelledEvent, {});
    await cancelledNotificationService.processBookingPaid(cancelledEvent, {});

    const [ticketCount, emailCount, ticketInbox, notificationInbox] = await Promise.all([
      ticketDatabase.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM ticket.tickets WHERE booking_id = $1',
        [cancelledBookingId],
      ),
      notificationDatabase.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM notification.email_delivery_logs WHERE booking_id = $1',
        [cancelledBookingId],
      ),
      ticketDatabase.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM ticket.inbox_events WHERE booking_id = $1',
        [cancelledBookingId],
      ),
      notificationDatabase.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM notification.inbox_events WHERE booking_id = $1',
        [cancelledBookingId],
      ),
    ]);
    expect(ticketCount.rows[0]?.count).toBe('0');
    expect(emailCount.rows[0]?.count).toBe('0');
    expect(ticketInbox.rows[0]?.count).toBe('1');
    expect(notificationInbox.rows[0]?.count).toBe('1');
    expect(markCancelledTicket).not.toHaveBeenCalled();
  });
});

async function publish(paid: BookingPaidV1): Promise<void> {
  await channel.assertExchange(bookingDomainExchange, 'topic', { durable: true });
  channel.publish(bookingDomainExchange, bookingPaidRoutingKey, Buffer.from(JSON.stringify(paid)), {
    persistent: true,
    contentType: 'application/json',
    messageId: paid.eventId,
    type: paid.eventType,
    headers: eventHeaders(paid),
  });
}

async function waitFor(condition: () => Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await condition())) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for fulfillment workers.');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function waitForMessage(queue: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const message = await channel.get(queue, { noAck: false });
    if (message) return message;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Timed out waiting for RabbitMQ dead-letter message.');
}

function bookingPaidEvent(id: string): BookingPaidV1 {
  const occurredAt = new Date().toISOString();
  return {
    eventId: randomUUID(),
    eventType: 'BookingPaidV1',
    eventVersion: 1,
    occurredAt,
    traceId: randomUUID().replaceAll('-', ''),
    requestId: randomUUID(),
    producer: 'booking-service',
    aggregateId: id,
    actorCategory: 'GUEST',
    checkoutSessionId: snapshot.owner.id,
    payload: {
      bookingId: id,
      tripId: randomUUID(),
      routeId: randomUUID(),
      routeCode: 'HCM-DLI',
      seatIds: ['A01', 'A02'],
      passengerCount: 2,
      totalPriceVnd: 700_000,
      paymentAttemptId: randomUUID(),
      paidAt: occurredAt,
      status: 'PAID',
    },
  };
}

function fulfillmentSnapshot(id: string): FulfillmentSnapshot {
  return {
    bookingId: id,
    bookingCode: 'BV-2030-WORKER',
    status: 'PAID',
    owner: { type: 'GUEST_SESSION', id: randomUUID() },
    contactEmail: 'fulfillment@example.com',
    trip: {
      routeCode: 'HCM-DLI',
      originName: 'TP.HCM',
      destinationName: 'Đà Lạt',
      pickupName: 'Bến xe Miền Đông',
      dropoffName: 'Bến xe Liên tỉnh Đà Lạt',
      departureAt: '2030-06-20T01:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
      vehicleCode: 'TB-L22-01',
      vehiclePlate: '51B-220.02',
    },
    passengers: [
      { id: randomUUID(), seatId: 'A01', fullName: 'Nguyễn Văn An' },
      { id: randomUUID(), seatId: 'A02', fullName: 'Trần Thị Bình' },
    ],
    totalPriceVnd: 700_000,
    paidAt: new Date().toISOString(),
  };
}

function eventHeaders(paid: BookingPaidV1): Record<string, string> {
  return {
    eventId: paid.eventId,
    eventType: paid.eventType,
    eventVersion: '1',
    traceId: paid.traceId,
    requestId: paid.requestId,
    producer: paid.producer,
    aggregateId: paid.aggregateId,
  };
}

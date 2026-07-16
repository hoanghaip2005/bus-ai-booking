import { Inject, Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';

import { TicketDatabase } from './ticket.database';
import type {
  GeneratedTicket,
  IssuedTicketReference,
  TicketDocumentView,
  TicketOwner,
} from './ticket.types';

interface ProcessingRow extends QueryResultRow {
  booking_id: string;
  fulfilled_at: Date | null;
  issued_at: Date | null;
  ticket_count: string;
  last_error_code: string | null;
}

interface TicketRow extends QueryResultRow {
  id: string;
  booking_id: string;
  ticket_code: string;
  booking_code: string;
  passenger_name: string;
  seat_id: string;
  route_label: string;
  pickup_name: string;
  dropoff_name: string;
  departure_at: Date;
  vehicle_label: string;
  qr_payload: string;
  html_content: string;
  pdf_document: Buffer;
  issued_at: Date;
}

@Injectable()
export class TicketRepository {
  constructor(@Inject(TicketDatabase) private readonly database: TicketDatabase) {}

  async processingState(eventId: string): Promise<{
    bookingId: string;
    fulfilled: boolean;
    issuedAt?: string;
    ticketCount: number;
    skipped: boolean;
  } | null> {
    const result = await this.database.query<ProcessingRow>(
      `SELECT inbox.booking_id, inbox.fulfilled_at,
              min(tickets.issued_at) AS issued_at,
              count(tickets.id)::text AS ticket_count,
              inbox.last_error_code
       FROM ticket.inbox_events AS inbox
       LEFT JOIN ticket.tickets AS tickets ON tickets.booking_id = inbox.booking_id
       WHERE inbox.event_id = $1
       GROUP BY inbox.booking_id, inbox.fulfilled_at, inbox.last_error_code`,
      [eventId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      bookingId: row.booking_id,
      fulfilled: row.fulfilled_at !== null,
      ...(row.issued_at !== null && { issuedAt: row.issued_at.toISOString() }),
      ticketCount: Number(row.ticket_count),
      skipped: row.last_error_code === 'BOOKING_CANCELLED',
    };
  }

  async recordSkippedEvent(input: {
    eventId: string;
    eventType: string;
    bookingId: string;
    traceId: string;
    requestId: string;
    processedAt: string;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO ticket.inbox_events (
        event_id, event_type, booking_id, trace_id, request_id, fulfilled_at, last_error_code
      ) VALUES ($1, $2, $3, $4, $5, $6, 'BOOKING_CANCELLED')
      ON CONFLICT (event_id) DO NOTHING`,
      [
        input.eventId,
        input.eventType,
        input.bookingId,
        input.traceId,
        input.requestId,
        input.processedAt,
      ],
    );
  }

  async persistEventAndTickets(input: {
    eventId: string;
    eventType: string;
    bookingId: string;
    traceId: string;
    requestId: string;
    tickets: GeneratedTicket[];
  }): Promise<boolean> {
    return this.database.withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO ticket.inbox_events (
          event_id, event_type, booking_id, trace_id, request_id
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (event_id) DO NOTHING`,
        [input.eventId, input.eventType, input.bookingId, input.traceId, input.requestId],
      );
      if (inserted.rowCount !== 1) return false;
      for (const ticket of input.tickets) {
        await client.query(
          `INSERT INTO ticket.tickets (
            id, booking_id, passenger_id, checkout_owner_type, checkout_owner_id,
            ticket_code, booking_code, passenger_name, seat_id, route_label,
            pickup_name, dropoff_name, departure_at, vehicle_label, qr_payload,
            html_content, pdf_document, issued_at
          ) VALUES (
            $1, $2, $3, $4, $5,
            $6, $7, $8, $9, $10,
            $11, $12, $13, $14, $15,
            $16, $17, $18
          )
          ON CONFLICT ON CONSTRAINT ticket_booking_passenger_key DO NOTHING`,
          [
            ticket.id,
            ticket.bookingId,
            ticket.passengerId,
            ticket.owner.type,
            ticket.owner.id,
            ticket.ticketCode,
            ticket.bookingCode,
            ticket.passengerName,
            ticket.seatId,
            ticket.routeLabel,
            ticket.pickupName,
            ticket.dropoffName,
            ticket.departureAt,
            ticket.vehicleLabel,
            ticket.qrPayload,
            ticket.htmlContent,
            ticket.pdfDocument,
            ticket.issuedAt,
          ],
        );
      }
      return true;
    });
  }

  async markFulfilled(eventId: string, fulfilledAt: string): Promise<void> {
    await this.database.query(
      `UPDATE ticket.inbox_events
       SET fulfilled_at = $2, last_error_code = NULL
       WHERE event_id = $1`,
      [eventId, fulfilledAt],
    );
  }

  async recordFailure(eventId: string, errorCode: string): Promise<void> {
    await this.database.query(
      'UPDATE ticket.inbox_events SET last_error_code = $2 WHERE event_id = $1',
      [eventId, errorCode],
    );
  }

  async listOwned(bookingId: string, owner: TicketOwner): Promise<TicketDocumentView[]> {
    const result = await this.database.query<TicketRow>(
      `SELECT
        id, booking_id, ticket_code, booking_code, passenger_name, seat_id,
        route_label, pickup_name, dropoff_name, departure_at, vehicle_label,
        qr_payload, html_content, pdf_document, issued_at
       FROM ticket.tickets
       WHERE booking_id = $1
         AND checkout_owner_type = $2
         AND checkout_owner_id = $3
       ORDER BY seat_id`,
      [bookingId, owner.type, owner.id],
    );
    return result.rows.map(mapTicket);
  }

  async listIssuedReferences(bookingId: string): Promise<IssuedTicketReference[]> {
    const result = await this.database.query<
      QueryResultRow & {
        id: string;
        passenger_id: string;
        ticket_code: string;
        qr_payload: string;
      }
    >(
      `SELECT id, passenger_id, ticket_code, qr_payload
       FROM ticket.tickets WHERE booking_id = $1 ORDER BY passenger_id`,
      [bookingId],
    );
    return result.rows.map((row) => ({
      ticketId: row.id,
      passengerId: row.passenger_id,
      ticketCode: row.ticket_code,
      qrPayload: row.qr_payload,
    }));
  }

  ping(): Promise<void> {
    return this.database.ping();
  }
}

function mapTicket(row: TicketRow): TicketDocumentView {
  return {
    id: row.id,
    bookingId: row.booking_id,
    ticketCode: row.ticket_code,
    bookingCode: row.booking_code,
    passengerName: row.passenger_name,
    seatId: row.seat_id,
    routeLabel: row.route_label,
    pickupName: row.pickup_name,
    dropoffName: row.dropoff_name,
    departureAt: row.departure_at.toISOString(),
    vehicleLabel: row.vehicle_label,
    qrPayload: row.qr_payload,
    htmlContent: row.html_content,
    pdfDocument: row.pdf_document,
    issuedAt: row.issued_at.toISOString(),
  };
}

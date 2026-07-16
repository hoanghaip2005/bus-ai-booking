import { BookingClientError } from './booking-client';
import { authenticatedHeaders } from '../../lib/auth-session';

export interface BookingTicket {
  id: string;
  ticketCode: string;
  bookingCode: string;
  passengerName: string;
  seatId: string;
  routeLabel: string;
  pickupName: string;
  dropoffName: string;
  departureAt: string;
  vehicleLabel: string;
  qrPayload: string;
  htmlContent: string;
  pdfBase64: string;
  issuedAt: string;
}

export interface BookingTicketDelivery {
  bookingId: string;
  ready: boolean;
  tickets: BookingTicket[];
}

export async function getBookingTickets(
  bookingId: string,
  checkoutSessionId: string,
): Promise<BookingTicketDelivery> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: authenticatedHeaders(checkoutSessionId),
    body: JSON.stringify({
      query: `query BookingTickets($bookingId: ID!) {
        bookingTickets(bookingId: $bookingId) {
          bookingId ready
          tickets {
            id ticketCode bookingCode passengerName seatId routeLabel
            pickupName dropoffName departureAt vehicleLabel qrPayload
            htmlContent pdfBase64 issuedAt
          }
        }
      }`,
      variables: { bookingId },
    }),
  });
  const body = (await response.json()) as {
    data?: { bookingTickets: BookingTicketDelivery };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  if (!response.ok || error || !body.data) {
    throw new BookingClientError(
      error?.message ?? 'Không thể tải vé điện tử lúc này.',
      error?.extensions?.code,
    );
  }
  return body.data.bookingTickets;
}

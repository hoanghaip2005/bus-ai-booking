export interface GuestBooking {
  id: string;
  bookingCode: string;
  status: 'PENDING_PAYMENT' | 'PAID' | 'TICKET_ISSUED' | 'EXPIRED';
  trip: {
    tripId: string;
    routeCode: string;
    originName: string;
    destinationName: string;
    departureAt: string;
    unitPriceVnd: number;
  };
  passengers: Array<{
    id: string;
    seatId: string;
    fullName: string;
    hasDocumentNumber: boolean;
  }>;
  totalPriceVnd: number;
  holdExpiresAt: string;
  createdAt: string;
}

export interface GuestBookingInput {
  holdToken: string;
  idempotencyKey: string;
  contact: { fullName: string; email: string; phone: string };
  passengers: Array<{
    seatId: string;
    fullName: string;
    phone?: string;
    documentNumber?: string;
  }>;
}

export class BookingClientError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'BookingClientError';
  }
}

export async function createGuestBooking(
  input: GuestBookingInput,
  checkoutSessionId: string,
): Promise<GuestBooking> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: authenticatedHeaders(checkoutSessionId),
    body: JSON.stringify({
      query: `mutation CreateBooking($input: CreateBookingInput!) {
        createBooking(input: $input) {
          id bookingCode status totalPriceVnd holdExpiresAt createdAt
          trip { tripId routeCode originName destinationName departureAt unitPriceVnd }
          passengers { id seatId fullName hasDocumentNumber }
        }
      }`,
      variables: { input },
    }),
  });
  const body = (await response.json()) as {
    data?: { createBooking: GuestBooking };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  if (!response.ok || error || !body.data) {
    throw new BookingClientError(
      error?.message ?? 'Không thể tạo booking lúc này.',
      error?.extensions?.code,
    );
  }
  return body.data.createBooking;
}
import { authenticatedHeaders } from '../../lib/auth-session';

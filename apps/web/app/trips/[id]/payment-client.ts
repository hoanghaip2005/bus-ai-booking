import { BookingClientError, type GuestBooking } from './booking-client';
import { authenticatedHeaders } from '../../lib/auth-session';

export interface SimulatedPaymentResult {
  paymentAttemptId: string;
  status: 'SUCCEEDED' | 'FAILED';
  booking: GuestBooking;
  failureCode?: string;
  processedAt: string;
}

export async function simulatePayment(
  input: {
    bookingId: string;
    outcome: 'SUCCESS' | 'FAILURE';
    idempotencyKey: string;
  },
  checkoutSessionId: string,
): Promise<SimulatedPaymentResult> {
  const response = await fetch('/graphql', {
    method: 'POST',
    headers: authenticatedHeaders(checkoutSessionId),
    body: JSON.stringify({
      query: `mutation SimulatePayment($input: SimulatePaymentInput!) {
        simulatePayment(input: $input) {
          paymentAttemptId status failureCode processedAt
          booking {
            id bookingCode status totalPriceVnd holdExpiresAt createdAt
            trip { tripId routeCode originName destinationName departureAt unitPriceVnd }
            passengers { id seatId fullName hasDocumentNumber }
          }
        }
      }`,
      variables: { input },
    }),
  });
  const body = (await response.json()) as {
    data?: { simulatePayment: SimulatedPaymentResult };
    errors?: Array<{ message: string; extensions?: { code?: string } }>;
  };
  const error = body.errors?.[0];
  if (!response.ok || error || !body.data) {
    throw new BookingClientError(
      error?.message ?? 'Không thể xử lý thanh toán mô phỏng lúc này.',
      error?.extensions?.code,
    );
  }
  return body.data.simulatePayment;
}

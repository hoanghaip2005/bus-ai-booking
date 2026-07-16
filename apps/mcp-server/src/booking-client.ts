import { activePropagationHeaders, createRequestId, logEvent } from '@bus/observability';
import {
  BookingServiceClient,
  BookingStatus,
  type GetGuestBookingLookupResponse,
  type HealthResponse,
} from '@bus/contracts-proto/generated/booking';
import { credentials, Metadata, status, type CallOptions, type ServiceError } from '@grpc/grpc-js';

export class McpBookingError extends Error {
  constructor(
    readonly code: 'LOOKUP_DENIED' | 'DEPENDENCY_UNAVAILABLE',
    options?: ErrorOptions,
  ) {
    super('Booking lookup could not be completed.', options);
    this.name = 'McpBookingError';
  }
}

export interface BookingStatusView {
  bookingCode: string;
  status:
    | 'DRAFT'
    | 'PENDING_PAYMENT'
    | 'PAID'
    | 'TICKET_ISSUED'
    | 'CHECKED_IN'
    | 'COMPLETED'
    | 'EXPIRED'
    | 'CANCELLED';
  tripId: string;
  originName: string;
  destinationName: string;
  departureAt: string;
  timezone: 'Asia/Ho_Chi_Minh';
  seatIds: string[];
  ticketIssued: boolean;
  cancellationEligible: boolean;
}

export interface BookingClient {
  readiness(requestId?: string): Promise<void>;
  getGuestBookingStatus(
    bookingCode: string,
    normalizedEmail: string,
    requestId?: string,
  ): Promise<BookingStatusView>;
}

export class GrpcBookingClient implements BookingClient {
  private readonly client: InstanceType<typeof BookingServiceClient>;

  constructor(
    address = process.env.BOOKING_GRPC_URL ?? '127.0.0.1:50053',
    private readonly timeoutMs = 2_000,
  ) {
    this.client = new BookingServiceClient(address, credentials.createInsecure());
  }

  async readiness(requestId?: string): Promise<void> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call<HealthResponse>(
        (metadata, options, callback) =>
          this.client.health({ requestId: correlationId }, metadata, options, callback),
        correlationId,
      );
      if (response.status !== 'UP') throw new McpBookingError('DEPENDENCY_UNAVAILABLE');
    } catch (error) {
      this.normalizeError(error, correlationId, 'health');
    }
  }

  async getGuestBookingStatus(
    bookingCode: string,
    normalizedEmail: string,
    requestId?: string,
  ): Promise<BookingStatusView> {
    const correlationId = createRequestId(requestId);
    try {
      const response = await this.call<GetGuestBookingLookupResponse>(
        (metadata, options, callback) =>
          this.client.getGuestBookingLookup(
            { bookingCode, normalizedEmail, requestId: correlationId },
            metadata,
            options,
            callback,
          ),
        correlationId,
      );
      if (!response.booking) throw new McpBookingError('LOOKUP_DENIED');
      const booking = response.booking;
      return {
        bookingCode: booking.bookingCode,
        status: bookingStatusName(booking.status),
        tripId: booking.tripId,
        originName: booking.originName,
        destinationName: booking.destinationName,
        departureAt: booking.departureAt,
        timezone: 'Asia/Ho_Chi_Minh',
        seatIds: booking.seatIds ?? [],
        ticketIssued: booking.ticketIssued,
        cancellationEligible: booking.cancellationEligible,
      };
    } catch (error) {
      this.normalizeError(error, correlationId, 'guestLookup');
    }
  }

  private call<T>(
    operation: (
      metadata: Metadata,
      options: Partial<CallOptions>,
      callback: (error: ServiceError | null, response: T) => void,
    ) => void,
    requestId: string,
  ): Promise<T> {
    const metadata = new Metadata();
    metadata.set('x-request-id', requestId);
    for (const [key, value] of Object.entries(activePropagationHeaders())) metadata.set(key, value);
    return new Promise((resolve, reject) => {
      operation(metadata, { deadline: new Date(Date.now() + this.timeoutMs) }, (error, response) =>
        error ? reject(error) : resolve(response),
      );
    });
  }

  private normalizeError(error: unknown, requestId: string, operation: string): never {
    if (error instanceof McpBookingError) throw error;
    const grpcCode =
      typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
    const code =
      grpcCode === status.NOT_FOUND || grpcCode === status.INVALID_ARGUMENT
        ? 'LOOKUP_DENIED'
        : 'DEPENDENCY_UNAVAILABLE';
    logEvent({
      service: 'mcp-server',
      level: code === 'LOOKUP_DENIED' ? 'info' : 'error',
      event: `booking.${operation}.failed`,
      message: 'MCP Booking request failed.',
      requestId,
      fields: { code },
    });
    throw new McpBookingError(code, { cause: error });
  }
}

function bookingStatusName(statusValue: BookingStatus): BookingStatusView['status'] {
  switch (statusValue) {
    case BookingStatus.BOOKING_STATUS_DRAFT:
      return 'DRAFT';
    case BookingStatus.BOOKING_STATUS_PENDING_PAYMENT:
      return 'PENDING_PAYMENT';
    case BookingStatus.BOOKING_STATUS_PAID:
      return 'PAID';
    case BookingStatus.BOOKING_STATUS_TICKET_ISSUED:
      return 'TICKET_ISSUED';
    case BookingStatus.BOOKING_STATUS_CHECKED_IN:
      return 'CHECKED_IN';
    case BookingStatus.BOOKING_STATUS_COMPLETED:
      return 'COMPLETED';
    case BookingStatus.BOOKING_STATUS_EXPIRED:
      return 'EXPIRED';
    case BookingStatus.BOOKING_STATUS_CANCELLED:
      return 'CANCELLED';
    default:
      throw new McpBookingError('DEPENDENCY_UNAVAILABLE');
  }
}

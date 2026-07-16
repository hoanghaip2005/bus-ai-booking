export const searchCacheStatuses = ['HIT', 'MISS', 'BYPASS'] as const;
export type SearchCacheStatus = (typeof searchCacheStatuses)[number];

export const seatStatusChangedChannel = 'seat-inventory:events:seat-status:v1';

export const searchActorCategories = ['GUEST', 'CUSTOMER', 'STAFF', 'ADMIN', 'SYSTEM'] as const;
export type SearchActorCategory = (typeof searchActorCategories)[number];

export interface SearchPerformedV1 {
  eventId: string;
  eventType: 'SearchPerformedV1';
  eventVersion: 1;
  occurredAt: string;
  traceId: string;
  producer: 'catalog-service';
  searchSessionId: string;
  actorCategory: SearchActorCategory;
  payload: {
    originLocationId: string;
    destinationLocationId: string;
    travelDate: string;
    departureTimeFrom?: string;
    departureTimeTo?: string;
    minPriceVnd?: number;
    maxPriceVnd?: number;
    operatorCodes: string[];
    vehicleTypeCodes: string[];
    minimumRemainingSeats?: number;
    sort: 'DEPARTURE_EARLIEST' | 'PRICE_LOWEST' | 'DURATION_SHORTEST';
    resultCount: number;
    nearestDateCount: number;
    cacheStatus: SearchCacheStatus;
  };
}

export interface SearchPerformedV2 {
  eventId: string;
  eventType: 'SearchPerformedV2';
  eventVersion: 2;
  occurredAt: string;
  traceId: string;
  producer: 'catalog-service';
  searchSessionId: string;
  actorCategory: SearchActorCategory;
  payload: SearchPerformedV1['payload'] & {
    matchedRoutes: Array<{
      routeId: string;
      originName: string;
      destinationName: string;
    }>;
  };
}

export type SearchPerformedEvent = SearchPerformedV1 | SearchPerformedV2;

export interface SeatStatusChangedV1 {
  eventId: string;
  eventType: 'SeatStatusChangedV1';
  eventVersion: 1;
  occurredAt: string;
  producer: 'seat-inventory-service';
  tripId: string;
  seatIds: string[];
  status: 'HELD' | 'AVAILABLE';
  expiresAt?: string;
  version: number;
}

export interface SeatStatusChangedV2 {
  eventId: string;
  eventType: 'SeatStatusChangedV2';
  eventVersion: 2;
  occurredAt: string;
  producer: 'seat-inventory-service';
  tripId: string;
  seatIds: string[];
  status: 'BOOKED' | 'BLOCKED';
  version: number;
}

export type SeatStatusChangedEvent = SeatStatusChangedV1 | SeatStatusChangedV2;

export const bookingDomainExchange = 'bus.domain';
export const bookingEventsTopic = 'booking-events';
export const paymentEventsTopic = 'payment-events';

export const domainEventActorCategories = [
  'GUEST',
  'CUSTOMER',
  'STAFF',
  'ADMIN',
  'SYSTEM',
] as const;
export type DomainEventActorCategory = (typeof domainEventActorCategories)[number];

interface DomainEventEnvelope {
  eventId: string;
  eventVersion: 1;
  occurredAt: string;
  traceId: string;
  requestId: string;
  aggregateId: string;
  actorCategory: DomainEventActorCategory;
  checkoutSessionId?: string;
}

export interface BookingCreatedV1 extends DomainEventEnvelope {
  eventType: 'BookingCreatedV1';
  producer: 'booking-service';
  payload: {
    bookingId: string;
    tripId: string;
    routeId: string;
    routeCode: string;
    seatIds: string[];
    passengerCount: number;
    totalPriceVnd: number;
    status: 'PENDING_PAYMENT';
  };
}

export interface BookingPaidV1 extends DomainEventEnvelope {
  eventType: 'BookingPaidV1';
  producer: 'booking-service';
  payload: {
    bookingId: string;
    tripId: string;
    routeId: string;
    routeCode: string;
    seatIds: string[];
    passengerCount: number;
    totalPriceVnd: number;
    paymentAttemptId: string;
    paidAt: string;
    status: 'PAID';
  };
}

export interface BookingExpiredV1 extends DomainEventEnvelope {
  eventType: 'BookingExpiredV1';
  producer: 'booking-service';
  payload: {
    bookingId: string;
    tripId: string;
    routeId: string;
    routeCode: string;
    seatIds: string[];
    passengerCount: number;
    totalPriceVnd: number;
    expiredAt: string;
    reason: 'HOLD_EXPIRED' | 'DEPARTURE_REACHED';
    status: 'EXPIRED';
  };
}

export interface BookingCancelledV1 extends DomainEventEnvelope {
  eventType: 'BookingCancelledV1';
  producer: 'booking-service';
  payload: {
    bookingId: string;
    tripId: string;
    routeId: string;
    routeCode: string;
    seatIds: string[];
    passengerCount: number;
    totalPriceVnd: number;
    cancelledAt: string;
    policyCode: 'BEFORE_DEPARTURE_FULL_RELEASE';
    status: 'CANCELLED';
  };
}

export interface PaymentAttemptedV1 extends DomainEventEnvelope {
  eventType: 'PaymentAttemptedV1';
  producer: 'payment-service';
  payload: {
    paymentAttemptId: string;
    bookingId: string;
    requestedOutcome: 'SUCCESS' | 'FAILURE';
    status: 'SUCCEEDED' | 'FAILED';
    amountVnd: number;
    failureCode?: string;
  };
}

export type BookingDomainEvent =
  BookingCreatedV1 | BookingPaidV1 | BookingExpiredV1 | BookingCancelledV1;
export type AnalyticsFact = BookingDomainEvent | PaymentAttemptedV1 | SearchPerformedEvent;

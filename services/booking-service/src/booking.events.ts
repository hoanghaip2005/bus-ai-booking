import { randomUUID } from 'node:crypto';

import type {
  BookingCreatedV1,
  BookingCancelledV1,
  BookingDomainEvent,
  BookingExpiredV1,
  BookingPaidV1,
  DomainEventActorCategory,
} from '@bus/contracts-events';
import { activePropagationHeaders, createRequestId, currentTraceContext } from '@bus/observability';

import type { BookingView, CheckoutOwner, PersistBookingInput } from './booking.types';

export interface EventDispatch<Event extends BookingDomainEvent = BookingDomainEvent> {
  event: Event;
  headers: Record<string, string>;
}

export type BookingExpiryReason = 'HOLD_EXPIRED' | 'DEPARTURE_REACHED';
export const cancellationPolicyCode = 'BEFORE_DEPARTURE_FULL_RELEASE' as const;

export function createBookingCreatedDispatch(
  booking: PersistBookingInput,
  requestId?: string,
): EventDispatch<BookingCreatedV1> {
  const context = createEventContext(booking.owner, requestId);
  const event: BookingCreatedV1 = {
    ...context.envelope,
    eventId: randomUUID(),
    eventType: 'BookingCreatedV1',
    eventVersion: 1,
    occurredAt: booking.createdAt,
    producer: 'booking-service',
    aggregateId: booking.id,
    payload: {
      bookingId: booking.id,
      tripId: booking.trip.tripId,
      routeId: booking.trip.routeId,
      routeCode: booking.trip.routeCode,
      seatIds: booking.passengers.map((passenger) => passenger.seatId).sort(),
      passengerCount: booking.passengers.length,
      totalPriceVnd: booking.totalPriceVnd,
      status: 'PENDING_PAYMENT',
    },
  };
  return { event, headers: eventHeaders(event, context.actorId, context.propagationHeaders) };
}

export function createBookingPaidDispatch(input: {
  booking: BookingView;
  owner: CheckoutOwner;
  paymentAttemptId: string;
  paidAt: string;
  requestId?: string;
}): EventDispatch<BookingPaidV1> {
  const context = createEventContext(input.owner, input.requestId);
  const event: BookingPaidV1 = {
    ...context.envelope,
    eventId: randomUUID(),
    eventType: 'BookingPaidV1',
    eventVersion: 1,
    occurredAt: input.paidAt,
    producer: 'booking-service',
    aggregateId: input.booking.id,
    payload: {
      ...bookingPayload(input.booking),
      paymentAttemptId: input.paymentAttemptId,
      paidAt: input.paidAt,
      status: 'PAID',
    },
  };
  return { event, headers: eventHeaders(event, context.actorId, context.propagationHeaders) };
}

export function createBookingExpiredDispatch(input: {
  booking: BookingView;
  owner: CheckoutOwner;
  expiredAt: string;
  reason: BookingExpiryReason;
  requestId?: string;
  actor?: { category: DomainEventActorCategory; id: string };
}): EventDispatch<BookingExpiredV1> {
  const context = createEventContext(input.owner, input.requestId, input.actor);
  const event: BookingExpiredV1 = {
    ...context.envelope,
    eventId: randomUUID(),
    eventType: 'BookingExpiredV1',
    eventVersion: 1,
    occurredAt: input.expiredAt,
    producer: 'booking-service',
    aggregateId: input.booking.id,
    payload: {
      ...bookingPayload(input.booking),
      expiredAt: input.expiredAt,
      reason: input.reason,
      status: 'EXPIRED',
    },
  };
  return { event, headers: eventHeaders(event, context.actorId, context.propagationHeaders) };
}

export function createBookingCancelledDispatch(input: {
  booking: BookingView;
  owner: CheckoutOwner;
  cancelledAt: string;
  requestId?: string;
}): EventDispatch<BookingCancelledV1> {
  const context = createEventContext(input.owner, input.requestId);
  const event: BookingCancelledV1 = {
    ...context.envelope,
    eventId: randomUUID(),
    eventType: 'BookingCancelledV1',
    eventVersion: 1,
    occurredAt: input.cancelledAt,
    producer: 'booking-service',
    aggregateId: input.booking.id,
    payload: {
      ...bookingPayload(input.booking),
      cancelledAt: input.cancelledAt,
      policyCode: cancellationPolicyCode,
      status: 'CANCELLED',
    },
  };
  return { event, headers: eventHeaders(event, context.actorId, context.propagationHeaders) };
}

function createEventContext(
  owner: CheckoutOwner,
  requestId?: string,
  actor?: { category: DomainEventActorCategory; id: string },
) {
  const actorCategory = actor?.category ?? ownerCategory(owner);
  return {
    envelope: {
      traceId: currentTraceContext().traceId ?? randomUUID().replaceAll('-', ''),
      requestId: createRequestId(requestId),
      actorCategory,
      ...(owner.type === 'GUEST_SESSION' && { checkoutSessionId: owner.id }),
    },
    actorId: actor?.id ?? owner.id,
    propagationHeaders: activePropagationHeaders(),
  };
}

function bookingPayload(booking: BookingView) {
  return {
    bookingId: booking.id,
    tripId: booking.trip.tripId,
    routeId: booking.trip.routeId,
    routeCode: booking.trip.routeCode,
    seatIds: booking.passengers.map((passenger) => passenger.seatId).sort(),
    passengerCount: booking.passengers.length,
    totalPriceVnd: booking.totalPriceVnd,
  };
}

function eventHeaders(
  event: BookingDomainEvent,
  actorId: string,
  propagationHeaders: Record<string, string>,
): Record<string, string> {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    eventVersion: String(event.eventVersion),
    traceId: event.traceId,
    requestId: event.requestId,
    producer: event.producer,
    aggregateId: event.aggregateId,
    actorCategory: event.actorCategory,
    actorId,
    ...propagationHeaders,
  };
}

function ownerCategory(owner: CheckoutOwner): 'GUEST' | 'CUSTOMER' {
  return owner.type === 'GUEST_SESSION' ? 'GUEST' : 'CUSTOMER';
}

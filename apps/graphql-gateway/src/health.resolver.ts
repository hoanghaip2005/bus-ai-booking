import { Inject } from '@nestjs/common';
import { Args, Context, Mutation, Query, Resolver, Subscription } from '@nestjs/graphql';
import { GraphQLError } from 'graphql';

import {
  BookingDependencyError,
  BookingCancellationPolicyGatewayError,
  BookingForbiddenGatewayError,
  BookingGatewayService,
  BookingHoldExpiredGatewayError,
  BookingInvalidStateGatewayError,
  BookingIdempotencyGatewayError,
  BookingSeatUnavailableGatewayError,
  BookingTripNotFoundGatewayError,
  BookingTicketNotFoundGatewayError,
  BookingWrongTripGatewayError,
  BookingLookupNotFoundGatewayError,
  BookingValidationGatewayError,
} from './booking.service';
import { CatalogDependencyError } from './catalog-dependency.error';
import type {
  CatalogHealthResponse,
  CatalogTripSearchInput,
  CatalogTripStop,
} from './catalog-health.service';
import { CatalogHealthService } from './catalog-health.service';
import {
  CatalogAuthorizationGatewayError,
  CatalogIdempotencyConflictGatewayError,
  CatalogInvalidStateTransitionGatewayError,
  CatalogInvalidConfigurationGatewayError,
} from './catalog-health.service';
import { CatalogNotFoundError } from './catalog-not-found.error';
import { CatalogValidationError } from './catalog-validation.error';
import {
  HoldExpiredGatewayError,
  HoldForbiddenGatewayError,
  IdempotencyConflictGatewayError,
  SeatInventoryDependencyError,
  SeatInventoryGatewayService,
  SeatMapNotFoundError,
  SeatMapValidationError,
  SeatUnavailableGatewayError,
} from './seat-inventory.service';
import { SeatStatusSubscriptionService } from './seat-status-subscription.service';
import { TicketDependencyError, TicketGatewayService } from './ticket.service';
import {
  IdentityDependencyError,
  IdentityForbiddenGatewayError,
  IdentityGatewayService,
  IdentityNotFoundGatewayError,
  IdentityUnauthenticatedGatewayError,
  IdentityValidationGatewayError,
} from './identity.service';
import {
  AnalyticsDependencyError,
  AnalyticsForbiddenError,
  AnalyticsGatewayService,
  AnalyticsValidationGatewayError,
} from './analytics.service';

interface HoldSeatsGraphQlInput {
  tripId: string;
  seatIds: string[];
  idempotencyKey: string;
  ttlSeconds: number;
}

interface ReleaseSeatHoldGraphQlInput {
  holdToken: string;
  idempotencyKey: string;
}

interface CreateBookingGraphQlInput {
  holdToken: string;
  idempotencyKey: string;
  contact: { fullName: string; email: string; phone: string };
  passengers: Array<{
    seatId: string;
    fullName: string;
    phone?: string | null;
    documentNumber?: string | null;
  }>;
}

interface SimulatePaymentGraphQlInput {
  bookingId: string;
  outcome: 'SUCCESS' | 'FAILURE';
  idempotencyKey: string;
}

interface CancelBookingGraphQlInput {
  bookingId: string;
  idempotencyKey: string;
}

interface LoginGraphQlInput {
  email: string;
  password: string;
}

interface RefreshSessionGraphQlInput {
  refreshToken: string;
}

interface SetTripActiveGraphQlInput {
  tripId: string;
  isActive: boolean;
}

interface TransitionTripStatusGraphQlInput {
  tripId: string;
  targetStatus: 'DEPARTED' | 'COMPLETED';
  idempotencyKey: string;
}

interface CreateTripGraphQlInput {
  routeId: string;
  vehicleId: string;
  seatLayoutVersionId: string;
  departureAt: string;
  arrivalAt: string;
  priceVnd: number;
  idempotencyKey: string;
}

interface StaffTicketLookupGraphQlInput {
  kind: 'BOOKING_CODE' | 'TICKET_CODE' | 'QR_PAYLOAD';
  credential: string;
}

interface CheckInTicketGraphQlInput {
  kind: 'TICKET_CODE' | 'QR_PAYLOAD';
  credential: string;
  tripId: string;
  idempotencyKey: string;
}

interface AdminOperationsGraphQlInput {
  tripId?: string | null;
  bookingLimit: number;
  auditLimit: number;
}

interface SetSeatBlockedGraphQlInput {
  tripId: string;
  seatIds: string[];
  blocked: boolean;
  reason: string;
  idempotencyKey: string;
}

type AdminCatalogMutationInput = Record<string, unknown> & { idempotencyKey: string };

interface PassengerProfileGraphQlInput {
  label: string;
  fullName: string;
  phone?: string | null;
}

@Resolver()
export class HealthResolver {
  constructor(
    @Inject(CatalogHealthService) private readonly catalogHealthService: CatalogHealthService,
    @Inject(SeatInventoryGatewayService)
    private readonly seatInventoryService?: SeatInventoryGatewayService,
    @Inject(SeatStatusSubscriptionService)
    private readonly seatStatusSubscriptionService?: SeatStatusSubscriptionService,
    @Inject(BookingGatewayService)
    private readonly bookingService?: BookingGatewayService,
    @Inject(TicketGatewayService)
    private readonly ticketService?: TicketGatewayService,
    @Inject(IdentityGatewayService)
    private readonly identityService?: IdentityGatewayService,
    @Inject(AnalyticsGatewayService)
    private readonly analyticsService?: AnalyticsGatewayService,
  ) {}

  @Query('platformHealth')
  platformHealth() {
    return {
      service: 'graphql-gateway',
      status: 'UP',
      version: '0.1.0',
      checkedAt: new Date().toISOString(),
    };
  }

  @Query('catalogHealth')
  async catalogHealth(@Context('requestId') requestId?: string): Promise<CatalogHealthResponse> {
    try {
      return await this.catalogHealthService.check(requestId);
    } catch (error) {
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: {
          code: 'DEPENDENCY_UNAVAILABLE',
          correlationId,
          retryable: true,
        },
      });
    }
  }

  @Query('locationSuggestions')
  async locationSuggestions(
    @Args('query') query: string,
    @Args('limit') limit: number,
    @Context('requestId') requestId?: string,
  ) {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2 || normalizedQuery.length > 100) {
      throw new GraphQLError('Query must contain between 2 and 100 characters.', {
        extensions: {
          code: 'VALIDATION_ERROR',
          correlationId: requestId,
          retryable: false,
          field: 'query',
        },
      });
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
      throw new GraphQLError('Limit must be an integer between 1 and 20.', {
        extensions: {
          code: 'VALIDATION_ERROR',
          correlationId: requestId,
          retryable: false,
          field: 'limit',
        },
      });
    }

    try {
      const response = await this.catalogHealthService.suggestLocations(
        normalizedQuery,
        limit,
        requestId,
      );
      return (response.suggestions ?? []).map((suggestion) => ({
        ...suggestion,
        kind: mapLocationKind(suggestion.kind),
      }));
    } catch (error) {
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: {
          code: 'DEPENDENCY_UNAVAILABLE',
          correlationId,
          retryable: true,
        },
      });
    }
  }

  @Query('searchTrips')
  async searchTrips(
    @Args('input') input: CatalogTripSearchInput,
    @Context('requestId') requestId?: string,
    @Context('searchSessionId') searchSessionId?: string,
  ) {
    if (!isUuid(input.originLocationId) || !isUuid(input.destinationLocationId)) {
      throw validationError('Origin and destination must be valid location IDs.', requestId);
    }
    if (input.originLocationId === input.destinationLocationId) {
      throw validationError('Origin and destination must be different.', requestId);
    }
    if (!isLocalDate(input.travelDate)) {
      throw validationError('Travel date must use the YYYY-MM-DD format.', requestId);
    }
    try {
      const response = await this.catalogHealthService.searchTrips(
        input,
        requestId,
        searchSessionId,
      );
      return {
        trips: response.trips ?? [],
        timezone: response.timezone,
        nearestTravelDates: response.nearestTravelDates ?? [],
      };
    } catch (error) {
      if (error instanceof CatalogValidationError) {
        throw validationError(error.message, error.requestId);
      }
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: {
          code: 'DEPENDENCY_UNAVAILABLE',
          correlationId,
          retryable: true,
        },
      });
    }
  }

  @Query('trip')
  async trip(@Args('id') id: string, @Context('requestId') requestId?: string) {
    if (!isUuid(id)) throw validationError('Trip ID must be a valid UUID.', requestId);

    try {
      const response = await this.catalogHealthService.getTrip(id, requestId);
      const trip = response.trip;
      if (!trip) throw new Error('Catalog GetTrip response omitted trip.');
      return {
        ...trip,
        timezone: response.timezone,
        stops: (trip.stops ?? []).map((stop) => ({ ...stop, kind: mapTripStopKind(stop) })),
        policies: trip.policies ?? [],
        seatLayout: trip.seatLayout
          ? { ...trip.seatLayout, seats: trip.seatLayout.seats ?? [] }
          : null,
      };
    } catch (error) {
      if (error instanceof CatalogNotFoundError) {
        throw new GraphQLError('Trip was not found.', {
          extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof CatalogValidationError) {
        throw validationError(error.message, error.requestId);
      }
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  @Query('seatMap')
  async seatMap(
    @Args('tripId') tripId: string,
    @Args('holdToken') holdToken: string | null,
    @Context('requestId') requestId?: string,
  ) {
    if (!isUuid(tripId)) throw validationError('Trip ID must be a valid UUID.', requestId);
    if (holdToken && !/^[A-Za-z0-9._-]{16,256}$/.test(holdToken)) {
      throw validationError('Hold token format is invalid.', requestId);
    }

    try {
      if (!this.seatInventoryService)
        throw new SeatInventoryDependencyError(requestId ?? 'missing-request-id');
      const response = await this.seatInventoryService.getSeatMap(tripId, holdToken, requestId);
      const seatMap = response.seatMap;
      if (!seatMap) throw new Error('Seat Inventory response omitted seat map.');
      return {
        ...seatMap,
        seats: (seatMap.seats ?? []).map((seat) => ({
          ...seat,
          status: mapSeatStatus(seat.status),
          heldByRequester: seat.heldByRequester ?? false,
        })),
      };
    } catch (error) {
      if (error instanceof SeatMapNotFoundError) {
        throw new GraphQLError('Trip was not found.', {
          extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof SeatMapValidationError) {
        throw validationError(error.message, error.requestId);
      }
      const correlationId =
        error instanceof SeatInventoryDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Seat Inventory Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  @Query('bookingTickets')
  async bookingTickets(
    @Args('bookingId') bookingId: string,
    @Context('requestId') requestId?: string,
    @Context('checkoutSessionId') checkoutSessionId?: string,
    @Context('authorization') authorization?: string,
  ) {
    if (!isUuid(bookingId)) throw validationError('Booking ID must be a valid UUID.', requestId);
    const { owner, actor } = await this.resolveCheckoutOwner(
      authorization,
      checkoutSessionId,
      requestId,
    );
    try {
      if (!this.ticketService) throw new TicketDependencyError(requestId ?? 'missing-request-id');
      return await this.ticketService.listBookingTickets(bookingId, owner, requestId, actor);
    } catch (error) {
      const correlationId = error instanceof TicketDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Ticket documents are temporarily unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  @Query('viewer')
  async viewer(
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    return this.authenticate(authorization, requestId);
  }

  @Query('myBookings')
  async myBookings(
    @Args('first') first: number,
    @Args('after') after: string | null,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (!Number.isInteger(first) || first < 1 || first > 20) {
      throw validationError('First must be an integer between 1 and 20.', requestId);
    }
    if (after && (after.length > 512 || !/^[A-Za-z0-9_-]+$/.test(after))) {
      throw validationError('Booking cursor is invalid.', requestId);
    }
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'CUSTOMER') {
      throw new GraphQLError('Customer role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      if (!this.bookingService) {
        throw new BookingDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.bookingService.listMyBookings(
        first,
        after ?? undefined,
        { id: actor.id, role: 'CUSTOMER', tokenId: actor.tokenId },
        requestId,
      );
      return {
        nodes: response.bookings.map((booking) => ({
          ...booking,
          status: mapBookingStatus(booking.status),
          passengers: booking.passengers ?? [],
        })),
        pageInfo: {
          endCursor: response.nextCursor ?? null,
          hasNextPage: Boolean(response.nextCursor),
        },
      };
    } catch (error) {
      throw mapBookingGraphQlError(error, requestId);
    }
  }

  @Query('bookingLookup')
  async bookingLookup(
    @Args('bookingCode') bookingCode: string,
    @Args('email') email: string,
    @Context('requestId') requestId?: string,
  ) {
    const normalizedCode = bookingCode.trim().toUpperCase();
    const normalizedEmail = email.trim().toLowerCase();
    if (
      !/^BV-\d{4}-[A-Z0-9]{10}$/.test(normalizedCode) ||
      normalizedEmail.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
    ) {
      throw validationError('Booking lookup credentials are invalid.', requestId);
    }
    try {
      if (!this.bookingService) {
        throw new BookingDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.bookingService.getGuestBookingLookup(
        normalizedCode,
        normalizedEmail,
        requestId,
      );
      if (!response.booking) throw new BookingDependencyError(response.requestId);
      return {
        ...response.booking,
        status: mapBookingStatus(response.booking.status),
        seatIds: response.booking.seatIds ?? [],
      };
    } catch (error) {
      throw mapBookingGraphQlError(error, requestId);
    }
  }

  @Query('passengerProfiles')
  async passengerProfiles(
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    const actor = await this.requireCustomerActor(authorization, requestId);
    try {
      if (!this.identityService) throw identityDependencyGraphQlError(requestId);
      return await this.identityService.listPassengerProfiles(actor, requestId);
    } catch (error) {
      throw mapIdentityGraphQlError(error, requestId);
    }
  }

  @Query('staffTicketLookup')
  async staffTicketLookup(
    @Args('input') input: StaffTicketLookupGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    validateStaffTicketCredential(input.kind, input.credential, requestId);
    const actor = await this.requireOperationsActor(authorization, requestId);
    try {
      if (!this.bookingService) {
        throw new BookingDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.bookingService.staffTicketLookup(
        input.kind,
        input.credential,
        actor,
        requestId,
      );
      return response.tickets.map((ticket) => ({
        ...ticket,
        bookingStatus: mapBookingStatus(ticket.bookingStatus),
      }));
    } catch (error) {
      throw mapBookingGraphQlError(error, requestId);
    }
  }

  @Query('adminOperations')
  async adminOperations(
    @Args('input') input: AdminOperationsGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (input.tripId && !isUuid(input.tripId)) {
      throw validationError('Trip ID must be a valid UUID.', requestId);
    }
    if (
      !Number.isInteger(input.bookingLimit) ||
      input.bookingLimit < 1 ||
      input.bookingLimit > 100 ||
      !Number.isInteger(input.auditLimit) ||
      input.auditLimit < 1 ||
      input.auditLimit > 100
    ) {
      throw validationError(
        'Admin operation limits must be integers between 1 and 100.',
        requestId,
      );
    }
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      if (!this.bookingService) {
        throw new BookingDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.bookingService.getAdminOperations(
        {
          ...(input.tripId && { tripId: input.tripId }),
          bookingLimit: input.bookingLimit,
          auditLimit: input.auditLimit,
        },
        { id: actor.id, role: 'ADMIN', tokenId: actor.tokenId },
        requestId,
      );
      return {
        bookings: response.bookings.map((booking) => ({
          ...booking,
          status: mapBookingStatus(booking.status),
          passengers: booking.passengers ?? [],
        })),
        summary: {
          ...response.summary,
          revenueVnd: Number(response.summary.revenueVnd),
          statusCounts: (response.summary.statusCounts ?? []).map((entry) => ({
            ...entry,
            status: mapBookingStatus(entry.status),
          })),
        },
        auditEvents: response.auditEvents,
      };
    } catch (error) {
      throw mapBookingGraphQlError(error, requestId);
    }
  }

  @Query('adminRevenueSummary')
  async adminRevenueSummary(
    @Args('input') input: { fromDate: string; toDate: string },
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (
      !isLocalDate(input.fromDate) ||
      !isLocalDate(input.toDate) ||
      input.fromDate > input.toDate
    ) {
      throw validationError('Analytics date range is invalid.', requestId);
    }
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      if (!this.analyticsService) {
        throw new AnalyticsDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.analyticsService.getRevenueSummary(
        input,
        { id: actor.id, role: 'ADMIN', tokenId: actor.tokenId },
        requestId,
      );
      return {
        ...response,
        totalRevenueVnd: Number(response.totalRevenueVnd),
        days: response.days.map((day) => ({ ...day, revenueVnd: Number(day.revenueVnd) })),
      };
    } catch (error) {
      if (error instanceof AnalyticsForbiddenError) {
        throw new GraphQLError(error.message, {
          extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof AnalyticsValidationGatewayError) {
        throw validationError(error.message, error.requestId);
      }
      const correlationId = error instanceof AnalyticsDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Analytics Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  @Query('adminPopularRoutes')
  async adminPopularRoutes(
    @Args('input') input: { fromDate: string; toDate: string; limit: number },
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    validateAnalyticsRange(input, requestId);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) {
      throw validationError('Popular route limit must be between 1 and 20.', requestId);
    }
    const actor = await this.requireAnalyticsAdmin(authorization, requestId);
    try {
      if (!this.analyticsService) {
        throw new AnalyticsDependencyError(requestId ?? 'missing-request-id');
      }
      return await this.analyticsService.getPopularRoutes(input, actor, requestId);
    } catch (error) {
      throw mapAnalyticsGraphQlError(error, requestId);
    }
  }

  @Query('adminSearchConversion')
  async adminSearchConversion(
    @Args('input') input: { fromDate: string; toDate: string },
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    validateAnalyticsRange(input, requestId);
    const actor = await this.requireAnalyticsAdmin(authorization, requestId);
    try {
      if (!this.analyticsService) {
        throw new AnalyticsDependencyError(requestId ?? 'missing-request-id');
      }
      return await this.analyticsService.getSearchConversion(input, actor, requestId);
    } catch (error) {
      throw mapAnalyticsGraphQlError(error, requestId);
    }
  }

  @Query('adminTicketSalesByRoute')
  async adminTicketSalesByRoute(
    @Args('input') input: { fromDate: string; toDate: string; limit: number },
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    validateAnalyticsRange(input, requestId);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 20) {
      throw validationError('Ticket sales route limit must be between 1 and 20.', requestId);
    }
    const actor = await this.requireAnalyticsAdmin(authorization, requestId);
    try {
      if (!this.analyticsService) {
        throw new AnalyticsDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.analyticsService.getTicketSalesByRoute(input, actor, requestId);
      return {
        ...response,
        routes: response.routes.map((route) => ({
          ...route,
          revenueVnd: Number(route.revenueVnd),
        })),
      };
    } catch (error) {
      throw mapAnalyticsGraphQlError(error, requestId);
    }
  }

  @Query('adminPaymentSummary')
  async adminPaymentSummary(
    @Args('input') input: { fromDate: string; toDate: string },
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    validateAnalyticsRange(input, requestId);
    const actor = await this.requireAnalyticsAdmin(authorization, requestId);
    try {
      if (!this.analyticsService) {
        throw new AnalyticsDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.analyticsService.getPaymentSummary(input, actor, requestId);
      return {
        ...response,
        succeededAmountVnd: Number(response.succeededAmountVnd),
        consumerLag: {
          available: response.consumerLag?.available ?? false,
          totalLag: Number(response.consumerLag?.totalLag ?? 0),
          topics: (response.consumerLag?.topics ?? []).map((topic) => ({
            topic: topic.topic,
            lag: Number(topic.lag),
          })),
        },
      };
    } catch (error) {
      throw mapAnalyticsGraphQlError(error, requestId);
    }
  }

  @Mutation('login')
  async login(@Args('input') input: LoginGraphQlInput, @Context('requestId') requestId?: string) {
    if (!this.identityService) throw identityDependencyGraphQlError(requestId);
    try {
      return await this.identityService.login(input.email, input.password, requestId);
    } catch (error) {
      throw mapIdentityGraphQlError(error, requestId);
    }
  }

  @Mutation('setSeatBlocked')
  async setSeatBlocked(
    @Args('input') input: SetSeatBlockedGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (!isUuid(input.tripId)) throw validationError('Trip ID must be a valid UUID.', requestId);
    if (
      !Array.isArray(input.seatIds) ||
      input.seatIds.length < 1 ||
      input.seatIds.length > 100 ||
      new Set(input.seatIds).size !== input.seatIds.length ||
      input.seatIds.some((seatId) => !/^[A-Za-z0-9._-]{1,64}$/.test(seatId))
    ) {
      throw validationError('Seat IDs must contain 1 to 100 unique valid values.', requestId);
    }
    validateIdempotencyKey(input.idempotencyKey, requestId);
    if (input.blocked && (input.reason.trim().length < 2 || input.reason.trim().length > 200)) {
      throw validationError('Block reason must contain between 2 and 200 characters.', requestId);
    }
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      if (!this.seatInventoryService) {
        throw new SeatInventoryDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.seatInventoryService.setSeatBlocked(
        { ...input, reason: input.reason.trim() },
        { id: actor.id, role: 'ADMIN', tokenId: actor.tokenId },
        requestId,
      );
      return { ...response, seatIds: response.seatIds ?? [] };
    } catch (error) {
      if (error instanceof SeatMapValidationError)
        throw validationError(error.message, error.requestId);
      if (error instanceof SeatMapNotFoundError) {
        throw new GraphQLError('Trip was not found.', {
          extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof SeatUnavailableGatewayError) {
        throw new GraphQLError('One or more seats are already booked.', {
          extensions: {
            code: 'SEAT_UNAVAILABLE',
            correlationId: error.requestId,
            retryable: false,
          },
        });
      }
      if (error instanceof IdempotencyConflictGatewayError) {
        throw new GraphQLError(error.message, {
          extensions: {
            code: 'IDEMPOTENCY_CONFLICT',
            correlationId: error.requestId,
            retryable: false,
          },
        });
      }
      throw new GraphQLError('Seat Inventory Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId: requestId, retryable: true },
      });
    }
  }

  @Mutation('refreshSession')
  async refreshSession(
    @Args('input') input: RefreshSessionGraphQlInput,
    @Context('requestId') requestId?: string,
  ) {
    if (!this.identityService) throw identityDependencyGraphQlError(requestId);
    try {
      return await this.identityService.refresh(input.refreshToken, requestId);
    } catch (error) {
      throw mapIdentityGraphQlError(error, requestId);
    }
  }

  @Mutation('logout')
  async logout(
    @Args('input') input: RefreshSessionGraphQlInput,
    @Context('requestId') requestId?: string,
  ) {
    if (!this.identityService) throw identityDependencyGraphQlError(requestId);
    try {
      return await this.identityService.logout(input.refreshToken, requestId);
    } catch (error) {
      throw mapIdentityGraphQlError(error, requestId);
    }
  }

  @Mutation('setTripActive')
  async setTripActive(
    @Args('input') input: SetTripActiveGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (!isUuid(input.tripId)) throw validationError('Trip ID must be a valid UUID.', requestId);
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      const response = await this.catalogHealthService.setTripActive(
        input.tripId,
        input.isActive,
        actor,
        requestId,
      );
      return { tripId: response.tripId, isActive: response.isActive, changed: response.changed };
    } catch (error) {
      if (error instanceof CatalogAuthorizationGatewayError) {
        throw new GraphQLError('Admin role is required.', {
          extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof CatalogNotFoundError) {
        throw new GraphQLError('Trip was not found.', {
          extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof CatalogValidationError) {
        throw validationError(error.message, error.requestId);
      }
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  @Query('adminTripPreparationOptions')
  async adminTripPreparationOptions(
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      return await this.catalogHealthService.listTripPreparationOptions(actor, requestId);
    } catch (error) {
      if (error instanceof CatalogAuthorizationGatewayError) {
        throw new GraphQLError('Admin role is required.', {
          extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
        });
      }
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  @Query('adminCatalog')
  async adminCatalog(
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    return this.adminCatalogOperation(authorization, requestId, (actor) =>
      this.catalogHealthService.getAdminCatalog(actor, requestId),
    );
  }

  @Mutation('saveAdminLocation')
  saveAdminLocation(
    @Args('input') input: AdminCatalogMutationInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    return this.adminCatalogMutation(input, authorization, requestId, (actor) =>
      this.catalogHealthService.saveLocation(input, actor, requestId),
    );
  }

  @Mutation('saveAdminRoute')
  saveAdminRoute(
    @Args('input') input: AdminCatalogMutationInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    return this.adminCatalogMutation(input, authorization, requestId, (actor) =>
      this.catalogHealthService.saveRoute(input, actor, requestId),
    );
  }

  @Mutation('saveAdminVehicle')
  saveAdminVehicle(
    @Args('input') input: AdminCatalogMutationInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    return this.adminCatalogMutation(input, authorization, requestId, (actor) =>
      this.catalogHealthService.saveVehicle(input, actor, requestId),
    );
  }

  @Mutation('saveAdminSeatLayout')
  saveAdminSeatLayout(
    @Args('input') input: AdminCatalogMutationInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    return this.adminCatalogMutation(input, authorization, requestId, (actor) =>
      this.catalogHealthService.saveSeatLayout(input, actor, requestId),
    );
  }

  @Mutation('updateAdminTrip')
  updateAdminTrip(
    @Args('input') input: AdminCatalogMutationInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    return this.adminCatalogMutation(input, authorization, requestId, (actor) =>
      this.catalogHealthService.updateTrip(input, actor, requestId),
    );
  }

  @Mutation('setCatalogResourceActive')
  setCatalogResourceActive(
    @Args('input') input: AdminCatalogMutationInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    return this.adminCatalogMutation(input, authorization, requestId, (actor) =>
      this.catalogHealthService.setCatalogResourceActive(input, actor, requestId),
    );
  }

  @Mutation('createTrip')
  async createTrip(
    @Args('input') input: CreateTripGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (![input.routeId, input.vehicleId, input.seatLayoutVersionId].every(isUuid)) {
      throw validationError('Route, vehicle, and seat-layout IDs must be valid UUIDs.', requestId);
    }
    validateIdempotencyKey(input.idempotencyKey, requestId);
    if (!Number.isSafeInteger(input.priceVnd) || input.priceVnd <= 0) {
      throw validationError('Fare must be a positive integer VND amount.', requestId);
    }
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      return await this.catalogHealthService.createTrip(input, actor, requestId);
    } catch (error) {
      if (error instanceof CatalogAuthorizationGatewayError) {
        throw new GraphQLError('Admin role is required.', {
          extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof CatalogValidationError)
        throw validationError(error.message, error.requestId);
      if (error instanceof CatalogInvalidConfigurationGatewayError) {
        throw new GraphQLError(error.message, {
          extensions: {
            code: 'INVALID_CONFIGURATION',
            correlationId: error.requestId,
            retryable: false,
          },
        });
      }
      if (error instanceof CatalogIdempotencyConflictGatewayError) {
        throw new GraphQLError(error.message, {
          extensions: {
            code: 'IDEMPOTENCY_CONFLICT',
            correlationId: error.requestId,
            retryable: false,
          },
        });
      }
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  @Mutation('transitionTripStatus')
  async transitionTripStatus(
    @Args('input') input: TransitionTripStatusGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (!isUuid(input.tripId)) throw validationError('Trip ID must be a valid UUID.', requestId);
    validateIdempotencyKey(input.idempotencyKey, requestId);
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      const response = await this.catalogHealthService.transitionTripStatus(
        input.tripId,
        input.targetStatus,
        input.idempotencyKey,
        actor,
        requestId,
      );
      return {
        tripId: response.tripId,
        previousStatus: response.previousStatus,
        status: response.status,
        changed: response.changed,
        transitionedAt: response.transitionedAt,
      };
    } catch (error) {
      if (error instanceof CatalogAuthorizationGatewayError) {
        throw new GraphQLError('Admin role is required.', {
          extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof CatalogNotFoundError) {
        throw new GraphQLError('Trip was not found.', {
          extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
        });
      }
      if (error instanceof CatalogInvalidStateTransitionGatewayError) {
        throw new GraphQLError(error.message, {
          extensions: {
            code: 'INVALID_STATE_TRANSITION',
            correlationId: error.requestId,
            retryable: false,
          },
        });
      }
      if (error instanceof CatalogIdempotencyConflictGatewayError) {
        throw new GraphQLError(error.message, {
          extensions: {
            code: 'IDEMPOTENCY_CONFLICT',
            correlationId: error.requestId,
            retryable: false,
          },
        });
      }
      if (error instanceof CatalogValidationError) {
        throw validationError(error.message, error.requestId);
      }
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  @Mutation('checkInTicket')
  async checkInTicket(
    @Args('input') input: CheckInTicketGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    validateStaffTicketCredential(input.kind, input.credential, requestId);
    if (!isUuid(input.tripId)) throw validationError('Trip ID must be a valid UUID.', requestId);
    validateIdempotencyKey(input.idempotencyKey, requestId);
    const actor = await this.requireOperationsActor(authorization, requestId);
    try {
      if (!this.bookingService) {
        throw new BookingDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.bookingService.checkInTicket(input, actor, requestId);
      return {
        transitioned: response.transitioned,
        ticket: {
          ...response.ticket,
          bookingStatus: mapBookingStatus(response.ticket.bookingStatus),
        },
      };
    } catch (error) {
      throw mapBookingGraphQlError(error, requestId);
    }
  }

  @Mutation('createPassengerProfile')
  async createPassengerProfile(
    @Args('input') input: PassengerProfileGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    const actor = await this.requireCustomerActor(authorization, requestId);
    try {
      if (!this.identityService) throw identityDependencyGraphQlError(requestId);
      return await this.identityService.createPassengerProfile(actor, input, requestId);
    } catch (error) {
      throw mapIdentityGraphQlError(error, requestId);
    }
  }

  @Mutation('updatePassengerProfile')
  async updatePassengerProfile(
    @Args('id') id: string,
    @Args('input') input: PassengerProfileGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (!isUuid(id)) throw validationError('Profile ID must be a valid UUID.', requestId);
    const actor = await this.requireCustomerActor(authorization, requestId);
    try {
      if (!this.identityService) throw identityDependencyGraphQlError(requestId);
      return await this.identityService.updatePassengerProfile(actor, id, input, requestId);
    } catch (error) {
      throw mapIdentityGraphQlError(error, requestId);
    }
  }

  @Mutation('deletePassengerProfile')
  async deletePassengerProfile(
    @Args('id') id: string,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (!isUuid(id)) throw validationError('Profile ID must be a valid UUID.', requestId);
    const actor = await this.requireCustomerActor(authorization, requestId);
    try {
      if (!this.identityService) throw identityDependencyGraphQlError(requestId);
      const response = await this.identityService.deletePassengerProfile(actor, id, requestId);
      return { id: response.profileId, deleted: response.deleted };
    } catch (error) {
      throw mapIdentityGraphQlError(error, requestId);
    }
  }

  @Mutation('holdSeats')
  async holdSeats(
    @Args('input') input: HoldSeatsGraphQlInput,
    @Context('requestId') requestId?: string,
    @Context('checkoutSessionId') checkoutSessionId?: string,
    @Context('authorization') authorization?: string,
  ) {
    validateHoldInput(input, requestId);
    const { owner, actor } = await this.resolveCheckoutOwner(
      authorization,
      checkoutSessionId,
      requestId,
    );
    try {
      if (!this.seatInventoryService)
        throw new SeatInventoryDependencyError(requestId ?? 'missing-request-id');
      const response = await this.seatInventoryService.holdSeats(
        {
          tripId: input.tripId,
          seatIds: input.seatIds,
          owner,
          idempotencyKey: input.idempotencyKey,
          requestedTtlSeconds: input.ttlSeconds,
          ...(actor && { actor }),
        },
        requestId,
      );
      if (!response.hold) throw new SeatInventoryDependencyError(response.requestId);
      return { ...response.hold, status: mapHoldStatus(response.hold.status) };
    } catch (error) {
      throw mapSeatGraphQlError(error, requestId);
    }
  }

  @Query('seatHold')
  async seatHold(
    @Args('holdToken') holdToken: string,
    @Context('requestId') requestId?: string,
    @Context('checkoutSessionId') checkoutSessionId?: string,
    @Context('authorization') authorization?: string,
  ) {
    validateToken(holdToken, requestId);
    const { owner, actor } = await this.resolveCheckoutOwner(
      authorization,
      checkoutSessionId,
      requestId,
    );
    try {
      if (!this.seatInventoryService)
        throw new SeatInventoryDependencyError(requestId ?? 'missing-request-id');
      const response = await this.seatInventoryService.getHold(holdToken, owner, requestId, actor);
      if (!response.hold) throw new SeatInventoryDependencyError(response.requestId);
      return { ...response.hold, status: mapHoldStatus(response.hold.status) };
    } catch (error) {
      throw mapSeatGraphQlError(error, requestId);
    }
  }

  @Mutation('releaseSeatHold')
  async releaseSeatHold(
    @Args('input') input: ReleaseSeatHoldGraphQlInput,
    @Context('requestId') requestId?: string,
    @Context('checkoutSessionId') checkoutSessionId?: string,
    @Context('authorization') authorization?: string,
  ) {
    validateToken(input.holdToken, requestId);
    validateIdempotencyKey(input.idempotencyKey, requestId);
    const { owner, actor } = await this.resolveCheckoutOwner(
      authorization,
      checkoutSessionId,
      requestId,
    );
    try {
      if (!this.seatInventoryService)
        throw new SeatInventoryDependencyError(requestId ?? 'missing-request-id');
      const response = await this.seatInventoryService.releaseHold(
        input.holdToken,
        owner,
        input.idempotencyKey,
        requestId,
        actor,
      );
      return { ...response, seatIds: response.seatIds ?? [] };
    } catch (error) {
      throw mapSeatGraphQlError(error, requestId);
    }
  }

  @Mutation('createBooking')
  async createBooking(
    @Args('input') input: CreateBookingGraphQlInput,
    @Context('requestId') requestId?: string,
    @Context('checkoutSessionId') checkoutSessionId?: string,
    @Context('authorization') authorization?: string,
  ) {
    validateCreateBookingInput(input, requestId);
    const { owner, actor } = await this.resolveCheckoutOwner(
      authorization,
      checkoutSessionId,
      requestId,
    );
    try {
      if (!this.bookingService) {
        throw new BookingDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.bookingService.createBooking(
        {
          holdToken: input.holdToken,
          owner,
          contact: input.contact,
          passengers: input.passengers,
          idempotencyKey: input.idempotencyKey,
          ...(actor && { actor }),
        },
        requestId,
      );
      const booking = response.booking;
      if (!booking?.trip || !booking.contact) {
        throw new BookingDependencyError(response.requestId);
      }
      return {
        ...booking,
        status: mapBookingStatus(booking.status),
        passengers: booking.passengers ?? [],
      };
    } catch (error) {
      throw mapBookingGraphQlError(error, requestId);
    }
  }

  @Mutation('simulatePayment')
  async simulatePayment(
    @Args('input') input: SimulatePaymentGraphQlInput,
    @Context('requestId') requestId?: string,
    @Context('checkoutSessionId') checkoutSessionId?: string,
    @Context('authorization') authorization?: string,
  ) {
    validateSimulatePaymentInput(input, requestId);
    const { owner, actor } = await this.resolveCheckoutOwner(
      authorization,
      checkoutSessionId,
      requestId,
    );
    try {
      if (!this.bookingService) {
        throw new BookingDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.bookingService.simulatePayment(
        {
          bookingId: input.bookingId,
          owner,
          outcome: input.outcome,
          idempotencyKey: input.idempotencyKey,
          ...(actor && { actor }),
        },
        requestId,
      );
      const result = response.result;
      if (!result?.booking?.trip || !result.booking.contact) {
        throw new BookingDependencyError(response.requestId);
      }
      return {
        ...result,
        status: mapPaymentStatus(result.status),
        booking: {
          ...result.booking,
          status: mapBookingStatus(result.booking.status),
          passengers: result.booking.passengers ?? [],
        },
      };
    } catch (error) {
      throw mapBookingGraphQlError(error, requestId);
    }
  }

  @Mutation('cancelBooking')
  async cancelBooking(
    @Args('input') input: CancelBookingGraphQlInput,
    @Context('authorization') authorization?: string,
    @Context('requestId') requestId?: string,
  ) {
    if (!isUuid(input.bookingId)) {
      throw validationError('Booking ID must be a valid UUID.', requestId);
    }
    if (!/^[A-Za-z0-9._-]{16,128}$/.test(input.idempotencyKey)) {
      throw validationError('Idempotency key format is invalid.', requestId);
    }
    const actor = await this.requireCustomerActor(authorization, requestId);
    try {
      if (!this.bookingService) {
        throw new BookingDependencyError(requestId ?? 'missing-request-id');
      }
      const response = await this.bookingService.cancelBooking(
        input.bookingId,
        input.idempotencyKey,
        { id: actor.id, role: 'CUSTOMER', tokenId: actor.tokenId },
        requestId,
      );
      const result = response.result;
      if (!result?.booking?.trip || !result.booking.contact) {
        throw new BookingDependencyError(response.requestId);
      }
      return {
        ...result,
        booking: {
          ...result.booking,
          status: mapBookingStatus(result.booking.status),
          passengers: result.booking.passengers ?? [],
        },
      };
    } catch (error) {
      throw mapBookingGraphQlError(error, requestId);
    }
  }

  @Subscription('platformPulse')
  async *platformPulse() {
    let sequence = 0;
    while (true) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      sequence += 1;
      yield {
        platformPulse: {
          sequence,
          service: 'graphql-gateway',
          status: 'UP',
          emittedAt: new Date().toISOString(),
        },
      };
    }
  }

  @Subscription('seatStatusChanged')
  seatStatusChanged(@Args('tripId') tripId: string) {
    if (!isUuid(tripId)) throw validationError('Trip ID must be a valid UUID.');
    if (!this.seatStatusSubscriptionService) {
      throw new GraphQLError('Seat status notifications are unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', retryable: true },
      });
    }
    return this.seatStatusSubscriptionService.subscribeToTrip(tripId);
  }

  private async authenticate(authorization: string | undefined, requestId?: string) {
    if (!this.identityService) throw identityDependencyGraphQlError(requestId);
    try {
      return await this.identityService.authenticate(authorization, requestId);
    } catch (error) {
      throw mapIdentityGraphQlError(error, requestId);
    }
  }

  private adminCatalogMutation<T extends object>(
    input: AdminCatalogMutationInput,
    authorization: string | undefined,
    requestId: string | undefined,
    operation: (actor: Awaited<ReturnType<HealthResolver['authenticate']>>) => Promise<T>,
  ): Promise<T> {
    validateIdempotencyKey(input.idempotencyKey, requestId);
    return this.adminCatalogOperation(authorization, requestId, operation);
  }

  private async adminCatalogOperation<T>(
    authorization: string | undefined,
    requestId: string | undefined,
    operation: (actor: Awaited<ReturnType<HealthResolver['authenticate']>>) => Promise<T>,
  ): Promise<T> {
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    try {
      const response = await operation(actor);
      if (typeof response === 'object' && response !== null && 'resourceType' in response) {
        const value = response as Record<string, unknown>;
        return { ...value, resourceType: normalizeCatalogResourceType(value.resourceType) } as T;
      }
      return response;
    } catch (error) {
      if (error instanceof CatalogAuthorizationGatewayError)
        throw new GraphQLError('Admin role is required.', {
          extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
        });
      if (error instanceof CatalogValidationError)
        throw validationError(error.message, error.requestId);
      if (error instanceof CatalogNotFoundError)
        throw new GraphQLError(error.message, {
          extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
        });
      if (error instanceof CatalogInvalidConfigurationGatewayError)
        throw new GraphQLError(error.message, {
          extensions: {
            code: 'INVALID_CONFIGURATION',
            correlationId: error.requestId,
            retryable: false,
          },
        });
      if (error instanceof CatalogIdempotencyConflictGatewayError)
        throw new GraphQLError(error.message, {
          extensions: {
            code: 'IDEMPOTENCY_CONFLICT',
            correlationId: error.requestId,
            retryable: false,
          },
        });
      const correlationId = error instanceof CatalogDependencyError ? error.requestId : requestId;
      throw new GraphQLError('Catalog Service is unavailable.', {
        extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
      });
    }
  }

  private async resolveCheckoutOwner(
    authorization: string | undefined,
    checkoutSessionId: string | undefined,
    requestId?: string,
  ) {
    if (!authorization?.trim()) return { owner: checkoutOwner(checkoutSessionId, requestId) };
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'CUSTOMER') {
      throw new GraphQLError('Customer role is required for registered checkout.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    return {
      owner: { type: 'CUSTOMER' as const, id: actor.id },
      actor: { id: actor.id, role: 'CUSTOMER' as const, tokenId: actor.tokenId },
    };
  }

  private async requireCustomerActor(authorization: string | undefined, requestId?: string) {
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'CUSTOMER') {
      throw new GraphQLError('Customer role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    return actor;
  }

  private async requireOperationsActor(authorization: string | undefined, requestId?: string) {
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'STAFF' && actor.role !== 'ADMIN') {
      throw new GraphQLError('Staff or admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    return { id: actor.id, role: actor.role, tokenId: actor.tokenId };
  }

  private async requireAnalyticsAdmin(authorization: string | undefined, requestId?: string) {
    const actor = await this.authenticate(authorization, requestId);
    if (actor.role !== 'ADMIN') {
      throw new GraphQLError('Admin role is required.', {
        extensions: { code: 'FORBIDDEN', correlationId: requestId, retryable: false },
      });
    }
    return { id: actor.id, role: 'ADMIN' as const, tokenId: actor.tokenId };
  }
}

function validateAnalyticsRange(
  input: { fromDate: string; toDate: string },
  requestId?: string,
): void {
  if (!isLocalDate(input.fromDate) || !isLocalDate(input.toDate) || input.fromDate > input.toDate) {
    throw validationError('Analytics date range is invalid.', requestId);
  }
}

function mapAnalyticsGraphQlError(error: unknown, requestId?: string): GraphQLError {
  if (error instanceof AnalyticsForbiddenError) {
    return new GraphQLError(error.message, {
      extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof AnalyticsValidationGatewayError) {
    return validationError(error.message, error.requestId);
  }
  const correlationId = error instanceof AnalyticsDependencyError ? error.requestId : requestId;
  return new GraphQLError('Analytics Service is unavailable.', {
    extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
  });
}

function mapIdentityGraphQlError(error: unknown, requestId?: string): GraphQLError {
  if (error instanceof IdentityValidationGatewayError) {
    return validationError(error.message, error.requestId);
  }
  if (error instanceof IdentityUnauthenticatedGatewayError) {
    return new GraphQLError('Authentication credentials are invalid or expired.', {
      extensions: { code: 'UNAUTHENTICATED', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof IdentityForbiddenGatewayError) {
    return new GraphQLError('Customer role is required.', {
      extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof IdentityNotFoundGatewayError) {
    return new GraphQLError('Passenger profile was not found.', {
      extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
    });
  }
  const correlationId = error instanceof IdentityDependencyError ? error.requestId : requestId;
  return identityDependencyGraphQlError(correlationId);
}

function identityDependencyGraphQlError(requestId?: string): GraphQLError {
  return new GraphQLError('Identity Service is unavailable.', {
    extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId: requestId, retryable: true },
  });
}

function mapLocationKind(kind: number | string): 'CITY' | 'STATION' {
  if (kind === 1 || kind === 'LOCATION_KIND_CITY' || kind === 'CITY') {
    return 'CITY';
  }
  if (kind === 2 || kind === 'LOCATION_KIND_STATION' || kind === 'STATION') {
    return 'STATION';
  }
  throw new Error(`Unsupported location kind: ${String(kind)}`);
}

function mapTripStopKind(stop: CatalogTripStop): 'PICKUP' | 'DROPOFF' | 'BOTH' {
  if (stop.kind === 1 || stop.kind === 'TRIP_STOP_KIND_PICKUP' || stop.kind === 'PICKUP') {
    return 'PICKUP';
  }
  if (stop.kind === 2 || stop.kind === 'TRIP_STOP_KIND_DROPOFF' || stop.kind === 'DROPOFF') {
    return 'DROPOFF';
  }
  if (stop.kind === 3 || stop.kind === 'TRIP_STOP_KIND_BOTH' || stop.kind === 'BOTH') {
    return 'BOTH';
  }
  throw new Error(`Unsupported trip stop kind: ${String(stop.kind)}`);
}

function mapSeatStatus(value: number | string): 'AVAILABLE' | 'HELD' | 'BOOKED' | 'BLOCKED' {
  if (value === 1 || value === 'SEAT_STATUS_AVAILABLE' || value === 'AVAILABLE') return 'AVAILABLE';
  if (value === 2 || value === 'SEAT_STATUS_HELD' || value === 'HELD') return 'HELD';
  if (value === 3 || value === 'SEAT_STATUS_BOOKED' || value === 'BOOKED') return 'BOOKED';
  if (value === 4 || value === 'SEAT_STATUS_BLOCKED' || value === 'BLOCKED') return 'BLOCKED';
  throw new Error(`Unsupported seat status: ${String(value)}`);
}

function mapHoldStatus(value: number | string): 'ACTIVE' | 'EXPIRED' | 'RELEASED' {
  if (value === 1 || value === 'HOLD_STATUS_ACTIVE' || value === 'ACTIVE') return 'ACTIVE';
  if (value === 2 || value === 'HOLD_STATUS_EXPIRED' || value === 'EXPIRED') return 'EXPIRED';
  if (value === 3 || value === 'HOLD_STATUS_RELEASED' || value === 'RELEASED') return 'RELEASED';
  throw new Error(`Unsupported hold status: ${String(value)}`);
}

function mapBookingStatus(value: number | string) {
  const statuses = [
    'UNSPECIFIED',
    'DRAFT',
    'PENDING_PAYMENT',
    'PAID',
    'TICKET_ISSUED',
    'CHECKED_IN',
    'COMPLETED',
    'EXPIRED',
    'CANCELLED',
  ] as const;
  if (typeof value === 'number' && statuses[value] && value > 0) return statuses[value];
  const normalized = String(value).replace('BOOKING_STATUS_', '');
  if (statuses.includes(normalized as (typeof statuses)[number]) && normalized !== 'UNSPECIFIED') {
    return normalized;
  }
  throw new Error(`Unsupported booking status: ${String(value)}`);
}

function mapPaymentStatus(value: number | string): 'SUCCEEDED' | 'FAILED' {
  if (value === 1 || value === 'SIMULATED_PAYMENT_STATUS_SUCCEEDED' || value === 'SUCCEEDED') {
    return 'SUCCEEDED';
  }
  if (value === 2 || value === 'SIMULATED_PAYMENT_STATUS_FAILED' || value === 'FAILED') {
    return 'FAILED';
  }
  throw new Error(`Unsupported simulated payment status: ${String(value)}`);
}

function validateHoldInput(input: HoldSeatsGraphQlInput, requestId?: string): void {
  if (!isUuid(input.tripId)) throw validationError('Trip ID must be a valid UUID.', requestId);
  if (
    !Array.isArray(input.seatIds) ||
    input.seatIds.length < 1 ||
    input.seatIds.length > 10 ||
    new Set(input.seatIds).size !== input.seatIds.length ||
    input.seatIds.some((seatId) => !/^[A-Za-z0-9._-]{1,64}$/.test(seatId))
  ) {
    throw validationError('Seat IDs must contain 1 to 10 unique valid values.', requestId);
  }
  validateIdempotencyKey(input.idempotencyKey, requestId);
  if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 300) {
    throw validationError('Hold TTL must be between 1 and 300 seconds.', requestId);
  }
}

function validateToken(value: string, requestId?: string): void {
  if (!/^[A-Za-z0-9._-]{16,256}$/.test(value)) {
    throw validationError('Hold token format is invalid.', requestId);
  }
}

function validateIdempotencyKey(value: string, requestId?: string): void {
  if (!/^[A-Za-z0-9._-]{16,128}$/.test(value)) {
    throw validationError('Idempotency key format is invalid.', requestId);
  }
}

function normalizeCatalogResourceType(value: unknown): string {
  if (typeof value === 'number')
    return (
      ['UNSPECIFIED', 'LOCATION', 'ROUTE', 'VEHICLE', 'SEAT_LAYOUT', 'TRIP'][value] ?? 'LOCATION'
    );
  return String(value).replace('CATALOG_RESOURCE_TYPE_', '');
}

function validateStaffTicketCredential(
  kind: 'BOOKING_CODE' | 'TICKET_CODE' | 'QR_PAYLOAD',
  credential: string,
  requestId?: string,
): void {
  const value = credential?.trim() ?? '';
  if (kind === 'BOOKING_CODE' && !/^BV-[A-Za-z0-9-]{8,100}$/.test(value)) {
    throw validationError('Booking code format is invalid.', requestId);
  }
  if (kind === 'TICKET_CODE' && !/^VT-[A-Za-z0-9-]{8,100}$/.test(value)) {
    throw validationError('Ticket code format is invalid.', requestId);
  }
  if (kind === 'QR_PAYLOAD' && !/^[A-Za-z0-9-]{16,256}$/.test(value)) {
    throw validationError('QR payload format is invalid.', requestId);
  }
}

function validateCreateBookingInput(input: CreateBookingGraphQlInput, requestId?: string): void {
  validateToken(input.holdToken, requestId);
  validateIdempotencyKey(input.idempotencyKey, requestId);
  if (!input.contact || !validName(input.contact.fullName)) {
    throw validationError(
      'Contact full name must contain between 2 and 100 characters.',
      requestId,
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.contact.email.trim())) {
    throw validationError('Contact email format is invalid.', requestId);
  }
  if (!validPhone(input.contact.phone)) {
    throw validationError('Contact phone must contain between 8 and 15 digits.', requestId);
  }
  if (
    !Array.isArray(input.passengers) ||
    input.passengers.length < 1 ||
    input.passengers.length > 10 ||
    new Set(input.passengers.map((passenger) => passenger.seatId)).size !== input.passengers.length
  ) {
    throw validationError('Booking must contain 1 to 10 passengers with unique seats.', requestId);
  }
  for (const passenger of input.passengers) {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(passenger.seatId) || !validName(passenger.fullName)) {
      throw validationError('Passenger name or seat ID is invalid.', requestId);
    }
    if (passenger.phone && !validPhone(passenger.phone)) {
      throw validationError('Passenger phone must contain between 8 and 15 digits.', requestId);
    }
    if (
      passenger.documentNumber &&
      !/^[A-Za-z0-9./-]{4,32}$/.test(passenger.documentNumber.trim())
    ) {
      throw validationError('Passenger document number format is invalid.', requestId);
    }
  }
}

function validateSimulatePaymentInput(
  input: SimulatePaymentGraphQlInput,
  requestId?: string,
): void {
  if (!isUuid(input.bookingId)) {
    throw validationError('Booking ID must be a valid UUID.', requestId);
  }
  if (input.outcome !== 'SUCCESS' && input.outcome !== 'FAILURE') {
    throw validationError('Simulated payment outcome is invalid.', requestId);
  }
  validateIdempotencyKey(input.idempotencyKey, requestId);
}

function validName(value: string): boolean {
  const length = value.trim().replace(/\s+/g, ' ').length;
  return length >= 2 && length <= 100;
}

function validPhone(value: string): boolean {
  const digits = value.replace(/[^0-9]/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function checkoutOwner(checkoutSessionId: string | undefined, requestId?: string) {
  if (!checkoutSessionId || !isUuid(checkoutSessionId)) {
    throw new GraphQLError('A checkout session is required.', {
      extensions: { code: 'UNAUTHENTICATED', correlationId: requestId, retryable: false },
    });
  }
  return { type: 'GUEST_SESSION' as const, id: checkoutSessionId };
}

function mapSeatGraphQlError(error: unknown, requestId?: string): GraphQLError {
  if (error instanceof SeatUnavailableGatewayError) {
    return new GraphQLError(error.message, {
      extensions: { code: 'SEAT_UNAVAILABLE', correlationId: error.requestId, retryable: true },
    });
  }
  if (error instanceof HoldExpiredGatewayError) {
    return new GraphQLError(error.message, {
      extensions: { code: 'HOLD_EXPIRED', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof HoldForbiddenGatewayError) {
    return new GraphQLError('Seat hold is unavailable.', {
      extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof IdempotencyConflictGatewayError) {
    return new GraphQLError(error.message, {
      extensions: {
        code: 'IDEMPOTENCY_CONFLICT',
        correlationId: error.requestId,
        retryable: false,
      },
    });
  }
  if (error instanceof SeatMapNotFoundError) {
    return new GraphQLError('Trip was not found.', {
      extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof SeatMapValidationError)
    return validationError(error.message, error.requestId);
  const correlationId = error instanceof SeatInventoryDependencyError ? error.requestId : requestId;
  return new GraphQLError('Seat Inventory Service is unavailable.', {
    extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
  });
}

function mapBookingGraphQlError(error: unknown, requestId?: string): GraphQLError {
  if (error instanceof BookingValidationGatewayError) {
    return validationError(error.message, error.requestId);
  }
  if (error instanceof BookingHoldExpiredGatewayError) {
    return new GraphQLError(error.message, {
      extensions: { code: 'HOLD_EXPIRED', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof BookingForbiddenGatewayError) {
    return new GraphQLError('Seat hold is unavailable.', {
      extensions: { code: 'FORBIDDEN', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof BookingIdempotencyGatewayError) {
    return new GraphQLError(error.message, {
      extensions: {
        code: 'IDEMPOTENCY_CONFLICT',
        correlationId: error.requestId,
        retryable: false,
      },
    });
  }
  if (error instanceof BookingTripNotFoundGatewayError) {
    return new GraphQLError('Trip was not found.', {
      extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof BookingTicketNotFoundGatewayError) {
    return new GraphQLError('Ticket was not found.', {
      extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof BookingLookupNotFoundGatewayError) {
    return new GraphQLError('Booking lookup credentials are invalid.', {
      extensions: { code: 'NOT_FOUND', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof BookingWrongTripGatewayError) {
    return new GraphQLError(error.message, {
      extensions: { code: 'WRONG_TRIP', correlationId: error.requestId, retryable: false },
    });
  }
  if (error instanceof BookingInvalidStateGatewayError) {
    return new GraphQLError(error.message, {
      extensions: {
        code: 'INVALID_STATE_TRANSITION',
        correlationId: error.requestId,
        retryable: false,
      },
    });
  }
  if (error instanceof BookingCancellationPolicyGatewayError) {
    return new GraphQLError(error.message, {
      extensions: {
        code: 'CANCELLATION_NOT_ALLOWED',
        correlationId: error.requestId,
        retryable: false,
      },
    });
  }
  if (error instanceof BookingSeatUnavailableGatewayError) {
    return new GraphQLError(error.message, {
      extensions: {
        code: 'SEAT_UNAVAILABLE',
        correlationId: error.requestId,
        retryable: false,
      },
    });
  }
  const correlationId = error instanceof BookingDependencyError ? error.requestId : requestId;
  return new GraphQLError('Booking Service is unavailable.', {
    extensions: { code: 'DEPENDENCY_UNAVAILABLE', correlationId, retryable: true },
  });
}

function validationError(message: string, correlationId?: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: 'VALIDATION_ERROR', correlationId, retryable: false },
  });
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isLocalDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

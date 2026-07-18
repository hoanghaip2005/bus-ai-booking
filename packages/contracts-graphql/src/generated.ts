import type { GraphQLResolveInfo, GraphQLScalarType, GraphQLScalarTypeConfig } from 'graphql';
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type RequireFields<T, K extends keyof T> = Omit<T, K> & { [P in K]-?: NonNullable<T[P]> };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string; }
  String: { input: string; output: string; }
  Boolean: { input: boolean; output: boolean; }
  Int: { input: number; output: number; }
  Float: { input: number; output: number; }
  Long: { input: number; output: number; }
};

export type AdminCatalog = {
  __typename?: 'AdminCatalog';
  locations: Array<AdminLocation>;
  operators: Array<AdminOperator>;
  routes: Array<AdminRoute>;
  seatLayouts: Array<AdminSeatLayout>;
  trips: Array<AdminTrip>;
  vehicleTypes: Array<AdminVehicleType>;
  vehicles: Array<AdminVehicle>;
};

export type AdminLocation = {
  __typename?: 'AdminLocation';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  kind: LocationKind;
  name: Scalars['String']['output'];
  parentLocationId: Maybe<Scalars['ID']['output']>;
};

export type AdminOperations = {
  __typename?: 'AdminOperations';
  auditEvents: Array<BookingAuditEvent>;
  bookings: Array<Booking>;
  summary: BookingOperationalSummary;
};

export type AdminOperationsInput = {
  auditLimit: Scalars['Int']['input'];
  bookingLimit: Scalars['Int']['input'];
  tripId: InputMaybe<Scalars['ID']['input']>;
};

export type AdminOperator = {
  __typename?: 'AdminOperator';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  name: Scalars['String']['output'];
};

export type AdminPaymentSummary = {
  __typename?: 'AdminPaymentSummary';
  attemptCount: Scalars['Int']['output'];
  consumerLag: AnalyticsConsumerLag;
  failedCount: Scalars['Int']['output'];
  lastProcessedAt: Maybe<Scalars['String']['output']>;
  succeededAmountVnd: Scalars['Long']['output'];
  succeededCount: Scalars['Int']['output'];
  successRate: Scalars['Float']['output'];
  timezone: Scalars['String']['output'];
};

export type AdminPopularRoutes = {
  __typename?: 'AdminPopularRoutes';
  lastProcessedAt: Maybe<Scalars['String']['output']>;
  routes: Array<PopularRoute>;
  timezone: Scalars['String']['output'];
};

export type AdminRevenueSummary = {
  __typename?: 'AdminRevenueSummary';
  days: Array<DailyRevenue>;
  lastProcessedAt: Maybe<Scalars['String']['output']>;
  paidBookingCount: Scalars['Int']['output'];
  ticketCount: Scalars['Int']['output'];
  timezone: Scalars['String']['output'];
  totalRevenueVnd: Scalars['Long']['output'];
};

export type AdminRoute = {
  __typename?: 'AdminRoute';
  code: Scalars['String']['output'];
  destinationLocationId: Scalars['ID']['output'];
  durationMinutes: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  originLocationId: Scalars['ID']['output'];
  stops: Array<AdminRouteStop>;
};

export type AdminRouteOption = {
  __typename?: 'AdminRouteOption';
  code: Scalars['String']['output'];
  destinationName: Scalars['String']['output'];
  durationMinutes: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  originName: Scalars['String']['output'];
};

export type AdminRouteStop = {
  __typename?: 'AdminRouteStop';
  id: Scalars['ID']['output'];
  locationId: Scalars['ID']['output'];
  offsetMinutes: Scalars['Int']['output'];
  stopKind: TripStopKind;
  stopOrder: Scalars['Int']['output'];
};

export type AdminSearchConversion = {
  __typename?: 'AdminSearchConversion';
  conversionRate: Scalars['Float']['output'];
  lastProcessedAt: Maybe<Scalars['String']['output']>;
  paidBookingCount: Scalars['Int']['output'];
  searchCount: Scalars['Int']['output'];
  timezone: Scalars['String']['output'];
};

export type AdminSeatLayout = {
  __typename?: 'AdminSeatLayout';
  deckCount: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  layoutJson: Scalars['String']['output'];
  name: Scalars['String']['output'];
  vehicleTypeId: Scalars['ID']['output'];
  version: Scalars['Int']['output'];
};

export type AdminTicketSalesByRoute = {
  __typename?: 'AdminTicketSalesByRoute';
  lastProcessedAt: Maybe<Scalars['String']['output']>;
  routes: Array<RouteTicketSales>;
  timezone: Scalars['String']['output'];
};

export type AdminTrip = {
  __typename?: 'AdminTrip';
  arrivalAt: Scalars['String']['output'];
  departureAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  priceVnd: Scalars['Int']['output'];
  routeId: Scalars['ID']['output'];
  status: TripStatus;
  vehicleId: Scalars['ID']['output'];
};

export type AdminVehicle = {
  __typename?: 'AdminVehicle';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  operatorId: Scalars['ID']['output'];
  plate: Scalars['String']['output'];
  seatLayoutVersionId: Scalars['ID']['output'];
  vehicleTypeId: Scalars['ID']['output'];
};

export type AdminVehicleOption = {
  __typename?: 'AdminVehicleOption';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  operatorName: Scalars['String']['output'];
  plate: Scalars['String']['output'];
  seatLayoutName: Scalars['String']['output'];
  seatLayoutVersion: Scalars['Int']['output'];
  seatLayoutVersionId: Scalars['ID']['output'];
  vehicleTypeName: Scalars['String']['output'];
};

export type AdminVehicleType = {
  __typename?: 'AdminVehicleType';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  seatCapacity: Scalars['Int']['output'];
};

export type AnalyticsConsumerLag = {
  __typename?: 'AnalyticsConsumerLag';
  available: Scalars['Boolean']['output'];
  topics: Array<AnalyticsTopicLag>;
  totalLag: Scalars['Int']['output'];
};

export type AnalyticsDateRangeInput = {
  fromDate: Scalars['String']['input'];
  toDate: Scalars['String']['input'];
};

export type AnalyticsTopicLag = {
  __typename?: 'AnalyticsTopicLag';
  lag: Scalars['Int']['output'];
  topic: Scalars['String']['output'];
};

export type AuthSession = {
  __typename?: 'AuthSession';
  accessExpiresAt: Scalars['String']['output'];
  accessToken: Scalars['String']['output'];
  refreshExpiresAt: Scalars['String']['output'];
  refreshToken: Scalars['String']['output'];
  user: AuthUser;
};

export type AuthUser = {
  __typename?: 'AuthUser';
  displayName: Scalars['String']['output'];
  email: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  role: UserRole;
};

export type Booking = {
  __typename?: 'Booking';
  bookingCode: Scalars['String']['output'];
  contact: BookingContact;
  createdAt: Scalars['String']['output'];
  holdExpiresAt: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  passengers: Array<BookingPassenger>;
  status: BookingStatus;
  totalPriceVnd: Scalars['Int']['output'];
  trip: BookingTripSnapshot;
};

export type BookingAuditEvent = {
  __typename?: 'BookingAuditEvent';
  action: Scalars['String']['output'];
  actorId: Scalars['ID']['output'];
  actorRole: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  occurredAt: Scalars['String']['output'];
  requestId: Scalars['String']['output'];
  targetId: Scalars['ID']['output'];
  targetType: Scalars['String']['output'];
  traceId: Scalars['String']['output'];
};

export type BookingConnection = {
  __typename?: 'BookingConnection';
  nodes: Array<Booking>;
  pageInfo: BookingPageInfo;
};

export type BookingContact = {
  __typename?: 'BookingContact';
  email: Scalars['String']['output'];
  fullName: Scalars['String']['output'];
  phone: Scalars['String']['output'];
};

export type BookingContactInput = {
  email: Scalars['String']['input'];
  fullName: Scalars['String']['input'];
  phone: Scalars['String']['input'];
};

export type BookingLookup = {
  __typename?: 'BookingLookup';
  bookingCode: Scalars['String']['output'];
  cancellationEligible: Scalars['Boolean']['output'];
  departureAt: Scalars['String']['output'];
  destinationName: Scalars['String']['output'];
  originName: Scalars['String']['output'];
  seatIds: Array<Scalars['String']['output']>;
  status: BookingStatus;
  ticketIssued: Scalars['Boolean']['output'];
  timezone: Scalars['String']['output'];
  tripId: Scalars['ID']['output'];
};

export type BookingOperationalSummary = {
  __typename?: 'BookingOperationalSummary';
  bookingCount: Scalars['Int']['output'];
  passengerCount: Scalars['Int']['output'];
  revenueVnd: Scalars['Long']['output'];
  statusCounts: Array<BookingStatusCount>;
};

export type BookingPageInfo = {
  __typename?: 'BookingPageInfo';
  endCursor: Maybe<Scalars['String']['output']>;
  hasNextPage: Scalars['Boolean']['output'];
};

export type BookingPassenger = {
  __typename?: 'BookingPassenger';
  fullName: Scalars['String']['output'];
  hasDocumentNumber: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  phone: Maybe<Scalars['String']['output']>;
  seatId: Scalars['ID']['output'];
};

export type BookingPassengerInput = {
  documentNumber: InputMaybe<Scalars['String']['input']>;
  fullName: Scalars['String']['input'];
  phone: InputMaybe<Scalars['String']['input']>;
  seatId: Scalars['ID']['input'];
};

export type BookingStatus =
  | 'CANCELLED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'DRAFT'
  | 'EXPIRED'
  | 'PAID'
  | 'PENDING_PAYMENT'
  | 'TICKET_ISSUED';

export type BookingStatusCount = {
  __typename?: 'BookingStatusCount';
  count: Scalars['Int']['output'];
  status: BookingStatus;
};

export type BookingTicket = {
  __typename?: 'BookingTicket';
  bookingCode: Scalars['String']['output'];
  departureAt: Scalars['String']['output'];
  dropoffName: Scalars['String']['output'];
  htmlContent: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  issuedAt: Scalars['String']['output'];
  passengerName: Scalars['String']['output'];
  pdfBase64: Scalars['String']['output'];
  pickupName: Scalars['String']['output'];
  qrPayload: Scalars['String']['output'];
  routeLabel: Scalars['String']['output'];
  seatId: Scalars['ID']['output'];
  ticketCode: Scalars['String']['output'];
  vehicleLabel: Scalars['String']['output'];
};

export type BookingTicketDelivery = {
  __typename?: 'BookingTicketDelivery';
  bookingId: Scalars['ID']['output'];
  ready: Scalars['Boolean']['output'];
  tickets: Array<BookingTicket>;
};

export type BookingTripSnapshot = {
  __typename?: 'BookingTripSnapshot';
  arrivalAt: Scalars['String']['output'];
  departureAt: Scalars['String']['output'];
  destinationName: Scalars['String']['output'];
  dropoffName: Scalars['String']['output'];
  operatorName: Scalars['String']['output'];
  originName: Scalars['String']['output'];
  pickupName: Scalars['String']['output'];
  routeCode: Scalars['String']['output'];
  routeId: Scalars['ID']['output'];
  timezone: Scalars['String']['output'];
  tripId: Scalars['ID']['output'];
  unitPriceVnd: Scalars['Int']['output'];
  vehicleCode: Scalars['String']['output'];
  vehiclePlate: Scalars['String']['output'];
  vehicleTypeName: Scalars['String']['output'];
};

export type CancelBookingInput = {
  bookingId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
};

export type CancellationResult = {
  __typename?: 'CancellationResult';
  booking: Booking;
  cancelledAt: Scalars['String']['output'];
  policyCode: Scalars['String']['output'];
  seatsReleased: Scalars['Boolean']['output'];
};

export type CatalogResourceType =
  | 'LOCATION'
  | 'ROUTE'
  | 'SEAT_LAYOUT'
  | 'TRIP'
  | 'VEHICLE';

export type CheckInResult = {
  __typename?: 'CheckInResult';
  ticket: StaffTicketView;
  transitioned: Scalars['Boolean']['output'];
};

export type CheckInTicketInput = {
  credential: Scalars['String']['input'];
  idempotencyKey: Scalars['String']['input'];
  kind: StaffTicketCheckInKind;
  tripId: Scalars['ID']['input'];
};

export type CreateBookingInput = {
  contact: BookingContactInput;
  holdToken: Scalars['String']['input'];
  idempotencyKey: Scalars['String']['input'];
  passengers: Array<BookingPassengerInput>;
};

export type CreateTripInput = {
  arrivalAt: Scalars['String']['input'];
  departureAt: Scalars['String']['input'];
  idempotencyKey: Scalars['String']['input'];
  priceVnd: Scalars['Int']['input'];
  routeId: Scalars['ID']['input'];
  seatLayoutVersionId: Scalars['ID']['input'];
  vehicleId: Scalars['ID']['input'];
};

export type CreateTripResult = {
  __typename?: 'CreateTripResult';
  arrivalAt: Scalars['String']['output'];
  created: Scalars['Boolean']['output'];
  createdAt: Scalars['String']['output'];
  departureAt: Scalars['String']['output'];
  priceVnd: Scalars['Int']['output'];
  routeId: Scalars['ID']['output'];
  seatLayoutVersionId: Scalars['ID']['output'];
  status: TripStatus;
  tripId: Scalars['ID']['output'];
  vehicleId: Scalars['ID']['output'];
};

export type DailyRevenue = {
  __typename?: 'DailyRevenue';
  localDate: Scalars['String']['output'];
  paidBookingCount: Scalars['Int']['output'];
  revenueVnd: Scalars['Long']['output'];
  ticketCount: Scalars['Int']['output'];
};

export type DeletePassengerProfilePayload = {
  __typename?: 'DeletePassengerProfilePayload';
  deleted: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
};

export type HealthStatus =
  | 'DEGRADED'
  | 'DOWN'
  | 'UP';

export type HoldSeatsInput = {
  idempotencyKey: Scalars['String']['input'];
  seatIds: Array<Scalars['ID']['input']>;
  tripId: Scalars['ID']['input'];
  ttlSeconds: Scalars['Int']['input'];
};

export type HoldStatus =
  | 'ACTIVE'
  | 'EXPIRED'
  | 'RELEASED';

export type LocationKind =
  | 'CITY'
  | 'STATION';

export type LocationSuggestion = {
  __typename?: 'LocationSuggestion';
  code: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  kind: LocationKind;
  name: Scalars['String']['output'];
  normalizedName: Scalars['String']['output'];
  parentLocationId: Maybe<Scalars['ID']['output']>;
};

export type LoginInput = {
  email: Scalars['String']['input'];
  password: Scalars['String']['input'];
};

export type LogoutInput = {
  refreshToken: Scalars['String']['input'];
};

export type LogoutPayload = {
  __typename?: 'LogoutPayload';
  revoked: Scalars['Boolean']['output'];
};

export type Mutation = {
  __typename?: 'Mutation';
  cancelBooking: CancellationResult;
  checkInTicket: CheckInResult;
  createBooking: Booking;
  createPassengerProfile: PassengerProfile;
  createTrip: CreateTripResult;
  deletePassengerProfile: DeletePassengerProfilePayload;
  holdSeats: SeatHold;
  login: AuthSession;
  logout: LogoutPayload;
  refreshSession: AuthSession;
  releaseSeatHold: ReleaseSeatHoldPayload;
  saveAdminLocation: SaveCatalogResourceResult;
  saveAdminRoute: SaveCatalogResourceResult;
  saveAdminSeatLayout: SaveCatalogResourceResult;
  saveAdminVehicle: SaveCatalogResourceResult;
  setCatalogResourceActive: SaveCatalogResourceResult;
  setSeatBlocked: SetSeatBlockedResult;
  setTripActive: TripActivationResult;
  simulatePayment: PaymentResult;
  transitionTripStatus: TripStatusTransitionResult;
  updateAdminTrip: SaveCatalogResourceResult;
  updatePassengerProfile: PassengerProfile;
};


export type MutationCancelBookingArgs = {
  input: CancelBookingInput;
};


export type MutationCheckInTicketArgs = {
  input: CheckInTicketInput;
};


export type MutationCreateBookingArgs = {
  input: CreateBookingInput;
};


export type MutationCreatePassengerProfileArgs = {
  input: PassengerProfileInput;
};


export type MutationCreateTripArgs = {
  input: CreateTripInput;
};


export type MutationDeletePassengerProfileArgs = {
  id: Scalars['ID']['input'];
};


export type MutationHoldSeatsArgs = {
  input: HoldSeatsInput;
};


export type MutationLoginArgs = {
  input: LoginInput;
};


export type MutationLogoutArgs = {
  input: LogoutInput;
};


export type MutationRefreshSessionArgs = {
  input: RefreshSessionInput;
};


export type MutationReleaseSeatHoldArgs = {
  input: ReleaseSeatHoldInput;
};


export type MutationSaveAdminLocationArgs = {
  input: SaveAdminLocationInput;
};


export type MutationSaveAdminRouteArgs = {
  input: SaveAdminRouteInput;
};


export type MutationSaveAdminSeatLayoutArgs = {
  input: SaveAdminSeatLayoutInput;
};


export type MutationSaveAdminVehicleArgs = {
  input: SaveAdminVehicleInput;
};


export type MutationSetCatalogResourceActiveArgs = {
  input: SetCatalogResourceActiveInput;
};


export type MutationSetSeatBlockedArgs = {
  input: SetSeatBlockedInput;
};


export type MutationSetTripActiveArgs = {
  input: SetTripActiveInput;
};


export type MutationSimulatePaymentArgs = {
  input: SimulatePaymentInput;
};


export type MutationTransitionTripStatusArgs = {
  input: TransitionTripStatusInput;
};


export type MutationUpdateAdminTripArgs = {
  input: UpdateAdminTripInput;
};


export type MutationUpdatePassengerProfileArgs = {
  id: Scalars['ID']['input'];
  input: PassengerProfileInput;
};

export type PassengerProfile = {
  __typename?: 'PassengerProfile';
  createdAt: Scalars['String']['output'];
  fullName: Scalars['String']['output'];
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  phone: Maybe<Scalars['String']['output']>;
  updatedAt: Scalars['String']['output'];
};

export type PassengerProfileInput = {
  fullName: Scalars['String']['input'];
  label: Scalars['String']['input'];
  phone: InputMaybe<Scalars['String']['input']>;
};

export type PaymentResult = {
  __typename?: 'PaymentResult';
  booking: Booking;
  failureCode: Maybe<Scalars['String']['output']>;
  paymentAttemptId: Scalars['ID']['output'];
  processedAt: Scalars['String']['output'];
  status: PaymentStatus;
};

export type PaymentStatus =
  | 'FAILED'
  | 'SUCCEEDED';

export type PlatformHealth = {
  __typename?: 'PlatformHealth';
  checkedAt: Scalars['String']['output'];
  service: Scalars['String']['output'];
  status: HealthStatus;
  version: Scalars['String']['output'];
};

export type PlatformPulse = {
  __typename?: 'PlatformPulse';
  emittedAt: Scalars['String']['output'];
  sequence: Scalars['Int']['output'];
  service: Scalars['String']['output'];
  status: HealthStatus;
};

export type PolicyReference = {
  __typename?: 'PolicyReference';
  code: Scalars['String']['output'];
  resourceUri: Scalars['String']['output'];
  summary: Scalars['String']['output'];
  title: Scalars['String']['output'];
};

export type PopularRoute = {
  __typename?: 'PopularRoute';
  conversionRate: Scalars['Float']['output'];
  paidBookingCount: Scalars['Int']['output'];
  routeCode: Scalars['String']['output'];
  routeId: Scalars['ID']['output'];
  routeLabel: Scalars['String']['output'];
  searchCount: Scalars['Int']['output'];
};

export type PopularRoutesInput = {
  fromDate: Scalars['String']['input'];
  limit: Scalars['Int']['input'];
  toDate: Scalars['String']['input'];
};

export type Query = {
  __typename?: 'Query';
  adminCatalog: AdminCatalog;
  adminOperations: AdminOperations;
  adminPaymentSummary: AdminPaymentSummary;
  adminPopularRoutes: AdminPopularRoutes;
  adminRevenueSummary: AdminRevenueSummary;
  adminSearchConversion: AdminSearchConversion;
  adminTicketSalesByRoute: AdminTicketSalesByRoute;
  adminTripPreparationOptions: TripPreparationOptions;
  bookingLookup: BookingLookup;
  bookingTickets: BookingTicketDelivery;
  catalogHealth: ServiceHealth;
  locationSuggestions: Array<LocationSuggestion>;
  myBookings: BookingConnection;
  passengerProfiles: Array<PassengerProfile>;
  platformHealth: PlatformHealth;
  searchTrips: TripSearchResult;
  seatHold: SeatHold;
  seatMap: SeatMap;
  staffTicketLookup: Array<StaffTicketView>;
  trip: Maybe<TripDetail>;
  viewer: AuthUser;
};


export type QueryAdminOperationsArgs = {
  input: AdminOperationsInput;
};


export type QueryAdminPaymentSummaryArgs = {
  input: AnalyticsDateRangeInput;
};


export type QueryAdminPopularRoutesArgs = {
  input: PopularRoutesInput;
};


export type QueryAdminRevenueSummaryArgs = {
  input: AnalyticsDateRangeInput;
};


export type QueryAdminSearchConversionArgs = {
  input: AnalyticsDateRangeInput;
};


export type QueryAdminTicketSalesByRouteArgs = {
  input: PopularRoutesInput;
};


export type QueryBookingLookupArgs = {
  bookingCode: Scalars['String']['input'];
  email: Scalars['String']['input'];
};


export type QueryBookingTicketsArgs = {
  bookingId: Scalars['ID']['input'];
};


export type QueryLocationSuggestionsArgs = {
  limit?: Scalars['Int']['input'];
  query: Scalars['String']['input'];
};


export type QueryMyBookingsArgs = {
  after: InputMaybe<Scalars['String']['input']>;
  first?: Scalars['Int']['input'];
};


export type QuerySearchTripsArgs = {
  input: SearchTripsInput;
};


export type QuerySeatHoldArgs = {
  holdToken: Scalars['String']['input'];
};


export type QuerySeatMapArgs = {
  holdToken: InputMaybe<Scalars['String']['input']>;
  tripId: Scalars['ID']['input'];
};


export type QueryStaffTicketLookupArgs = {
  input: StaffTicketLookupInput;
};


export type QueryTripArgs = {
  id: Scalars['ID']['input'];
};

export type RefreshSessionInput = {
  refreshToken: Scalars['String']['input'];
};

export type ReleaseSeatHoldInput = {
  holdToken: Scalars['String']['input'];
  idempotencyKey: Scalars['String']['input'];
};

export type ReleaseSeatHoldPayload = {
  __typename?: 'ReleaseSeatHoldPayload';
  released: Scalars['Boolean']['output'];
  releasedAt: Maybe<Scalars['String']['output']>;
  seatIds: Array<Scalars['ID']['output']>;
  tripId: Maybe<Scalars['ID']['output']>;
};

export type RouteTicketSales = {
  __typename?: 'RouteTicketSales';
  paidBookingCount: Scalars['Int']['output'];
  revenueVnd: Scalars['Long']['output'];
  routeCode: Scalars['String']['output'];
  routeId: Scalars['ID']['output'];
  routeLabel: Scalars['String']['output'];
  ticketCount: Scalars['Int']['output'];
};

export type SaveAdminLocationInput = {
  code: Scalars['String']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  idempotencyKey: Scalars['String']['input'];
  kind: LocationKind;
  name: Scalars['String']['input'];
  parentLocationId: InputMaybe<Scalars['ID']['input']>;
};

export type SaveAdminRouteInput = {
  code: Scalars['String']['input'];
  destinationLocationId: Scalars['ID']['input'];
  durationMinutes: Scalars['Int']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  idempotencyKey: Scalars['String']['input'];
  originLocationId: Scalars['ID']['input'];
  stops: Array<SaveAdminRouteStopInput>;
};

export type SaveAdminRouteStopInput = {
  id: InputMaybe<Scalars['ID']['input']>;
  locationId: Scalars['ID']['input'];
  offsetMinutes: Scalars['Int']['input'];
  stopKind: TripStopKind;
  stopOrder: Scalars['Int']['input'];
};

export type SaveAdminSeatLayoutInput = {
  deckCount: Scalars['Int']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  idempotencyKey: Scalars['String']['input'];
  layoutJson: Scalars['String']['input'];
  name: Scalars['String']['input'];
  vehicleTypeId: Scalars['ID']['input'];
  version: Scalars['Int']['input'];
};

export type SaveAdminVehicleInput = {
  code: Scalars['String']['input'];
  id: InputMaybe<Scalars['ID']['input']>;
  idempotencyKey: Scalars['String']['input'];
  operatorId: Scalars['ID']['input'];
  plate: Scalars['String']['input'];
  seatLayoutVersionId: Scalars['ID']['input'];
  vehicleTypeId: Scalars['ID']['input'];
};

export type SaveCatalogResourceResult = {
  __typename?: 'SaveCatalogResourceResult';
  changed: Scalars['Boolean']['output'];
  created: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  isActive: Scalars['Boolean']['output'];
  resourceType: CatalogResourceType;
  updatedAt: Scalars['String']['output'];
};

export type SearchTripsInput = {
  departureTimeFrom: InputMaybe<Scalars['String']['input']>;
  departureTimeTo: InputMaybe<Scalars['String']['input']>;
  destinationLocationId: Scalars['ID']['input'];
  maxPriceVnd: InputMaybe<Scalars['Int']['input']>;
  minPriceVnd: InputMaybe<Scalars['Int']['input']>;
  minimumRemainingSeats: InputMaybe<Scalars['Int']['input']>;
  operatorCodes: InputMaybe<Array<Scalars['String']['input']>>;
  originLocationId: Scalars['ID']['input'];
  sort: InputMaybe<TripSort>;
  travelDate: Scalars['String']['input'];
  vehicleTypeCodes: InputMaybe<Array<Scalars['String']['input']>>;
};

export type SeatDefinition = {
  __typename?: 'SeatDefinition';
  column: Scalars['Int']['output'];
  deck: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  row: Scalars['Int']['output'];
};

export type SeatHold = {
  __typename?: 'SeatHold';
  expiresAt: Scalars['String']['output'];
  remainingTtlSeconds: Scalars['Int']['output'];
  seatIds: Array<Scalars['ID']['output']>;
  status: HoldStatus;
  token: Scalars['String']['output'];
  totalPriceVnd: Scalars['Int']['output'];
  tripId: Scalars['ID']['output'];
  unitPriceVnd: Scalars['Int']['output'];
};

export type SeatLayout = {
  __typename?: 'SeatLayout';
  deckCount: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  seats: Array<SeatDefinition>;
  version: Scalars['Int']['output'];
};

export type SeatMap = {
  __typename?: 'SeatMap';
  deckCount: Scalars['Int']['output'];
  generatedAt: Scalars['String']['output'];
  layoutId: Scalars['ID']['output'];
  layoutName: Scalars['String']['output'];
  layoutVersion: Scalars['Int']['output'];
  seats: Array<SeatState>;
  tripId: Scalars['ID']['output'];
};

export type SeatState = {
  __typename?: 'SeatState';
  column: Scalars['Int']['output'];
  deck: Scalars['Int']['output'];
  heldByRequester: Scalars['Boolean']['output'];
  id: Scalars['ID']['output'];
  label: Scalars['String']['output'];
  row: Scalars['Int']['output'];
  status: SeatStatus;
};

export type SeatStatus =
  | 'AVAILABLE'
  | 'BLOCKED'
  | 'BOOKED'
  | 'HELD';

export type SeatStatusEvent = {
  __typename?: 'SeatStatusEvent';
  expiresAt: Maybe<Scalars['String']['output']>;
  occurredAt: Scalars['String']['output'];
  seatIds: Array<Scalars['ID']['output']>;
  status: SeatStatus;
  tripId: Scalars['ID']['output'];
  version: Scalars['Int']['output'];
};

export type ServiceHealth = {
  __typename?: 'ServiceHealth';
  checkedAt: Scalars['String']['output'];
  requestId: Scalars['String']['output'];
  service: Scalars['String']['output'];
  status: HealthStatus;
  traceId: Scalars['String']['output'];
  version: Scalars['String']['output'];
};

export type SetCatalogResourceActiveInput = {
  id: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  isActive: Scalars['Boolean']['input'];
  resourceType: CatalogResourceType;
};

export type SetSeatBlockedInput = {
  blocked: Scalars['Boolean']['input'];
  idempotencyKey: Scalars['String']['input'];
  reason: Scalars['String']['input'];
  seatIds: Array<Scalars['ID']['input']>;
  tripId: Scalars['ID']['input'];
};

export type SetSeatBlockedResult = {
  __typename?: 'SetSeatBlockedResult';
  blocked: Scalars['Boolean']['output'];
  changed: Scalars['Boolean']['output'];
  seatIds: Array<Scalars['ID']['output']>;
  tripId: Scalars['ID']['output'];
  updatedAt: Scalars['String']['output'];
};

export type SetTripActiveInput = {
  isActive: Scalars['Boolean']['input'];
  tripId: Scalars['ID']['input'];
};

export type SimulatePaymentInput = {
  bookingId: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  outcome: SimulatedPaymentOutcome;
};

export type SimulatedPaymentOutcome =
  | 'FAILURE'
  | 'SUCCESS';

export type StaffTicketCheckInKind =
  | 'QR_PAYLOAD'
  | 'TICKET_CODE';

export type StaffTicketCredentialKind =
  | 'BOOKING_CODE'
  | 'QR_PAYLOAD'
  | 'TICKET_CODE';

export type StaffTicketLookupInput = {
  credential: Scalars['String']['input'];
  kind: StaffTicketCredentialKind;
};

export type StaffTicketView = {
  __typename?: 'StaffTicketView';
  bookingCode: Scalars['String']['output'];
  bookingId: Scalars['ID']['output'];
  bookingStatus: BookingStatus;
  checkedInAt: Maybe<Scalars['String']['output']>;
  departureAt: Scalars['String']['output'];
  passengerId: Scalars['ID']['output'];
  passengerName: Scalars['String']['output'];
  routeLabel: Scalars['String']['output'];
  seatId: Scalars['ID']['output'];
  ticketCode: Scalars['String']['output'];
  ticketId: Scalars['ID']['output'];
  tripId: Scalars['ID']['output'];
};

export type Subscription = {
  __typename?: 'Subscription';
  platformPulse: PlatformPulse;
  seatStatusChanged: SeatStatusEvent;
};


export type SubscriptionSeatStatusChangedArgs = {
  tripId: Scalars['ID']['input'];
};

export type TransitionTripStatusInput = {
  idempotencyKey: Scalars['String']['input'];
  targetStatus: TripLifecycleTarget;
  tripId: Scalars['ID']['input'];
};

export type TripActivationResult = {
  __typename?: 'TripActivationResult';
  changed: Scalars['Boolean']['output'];
  isActive: Scalars['Boolean']['output'];
  tripId: Scalars['ID']['output'];
};

export type TripDetail = {
  __typename?: 'TripDetail';
  arrivalAt: Scalars['String']['output'];
  departureAt: Scalars['String']['output'];
  destinationName: Scalars['String']['output'];
  durationMinutes: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  operatorName: Scalars['String']['output'];
  originName: Scalars['String']['output'];
  policies: Array<PolicyReference>;
  priceVnd: Scalars['Int']['output'];
  remainingSeats: Scalars['Int']['output'];
  routeCode: Scalars['String']['output'];
  routeId: Scalars['ID']['output'];
  seatLayout: SeatLayout;
  status: TripStatus;
  stops: Array<TripStop>;
  timezone: Scalars['String']['output'];
  vehicleCode: Scalars['String']['output'];
  vehiclePlate: Scalars['String']['output'];
  vehicleTypeName: Scalars['String']['output'];
};

export type TripLifecycleTarget =
  | 'COMPLETED'
  | 'DEPARTED';

export type TripPreparationOptions = {
  __typename?: 'TripPreparationOptions';
  routes: Array<AdminRouteOption>;
  vehicles: Array<AdminVehicleOption>;
};

export type TripSearchResult = {
  __typename?: 'TripSearchResult';
  nearestTravelDates: Array<Scalars['String']['output']>;
  timezone: Scalars['String']['output'];
  trips: Array<TripSummary>;
};

export type TripSort =
  | 'DEPARTURE_EARLIEST'
  | 'DURATION_SHORTEST'
  | 'PRICE_LOWEST';

export type TripStatus =
  | 'BOARDING'
  | 'COMPLETED'
  | 'DEPARTED'
  | 'SCHEDULED';

export type TripStatusTransitionResult = {
  __typename?: 'TripStatusTransitionResult';
  changed: Scalars['Boolean']['output'];
  previousStatus: TripStatus;
  status: TripStatus;
  transitionedAt: Scalars['String']['output'];
  tripId: Scalars['ID']['output'];
};

export type TripStop = {
  __typename?: 'TripStop';
  id: Scalars['ID']['output'];
  kind: TripStopKind;
  locationId: Scalars['ID']['output'];
  name: Scalars['String']['output'];
  offsetMinutes: Scalars['Int']['output'];
  scheduledAt: Scalars['String']['output'];
  stopOrder: Scalars['Int']['output'];
};

export type TripStopKind =
  | 'BOTH'
  | 'DROPOFF'
  | 'PICKUP';

export type TripSummary = {
  __typename?: 'TripSummary';
  arrivalAt: Scalars['String']['output'];
  departureAt: Scalars['String']['output'];
  destinationName: Scalars['String']['output'];
  dropoffName: Scalars['String']['output'];
  durationMinutes: Scalars['Int']['output'];
  id: Scalars['ID']['output'];
  operatorName: Scalars['String']['output'];
  originName: Scalars['String']['output'];
  pickupName: Scalars['String']['output'];
  priceVnd: Scalars['Int']['output'];
  remainingSeats: Scalars['Int']['output'];
  routeId: Scalars['ID']['output'];
  vehicleCode: Scalars['String']['output'];
  vehicleTypeName: Scalars['String']['output'];
};

export type UpdateAdminTripInput = {
  arrivalAt: Scalars['String']['input'];
  departureAt: Scalars['String']['input'];
  id: Scalars['ID']['input'];
  idempotencyKey: Scalars['String']['input'];
  priceVnd: Scalars['Int']['input'];
  routeId: Scalars['ID']['input'];
  seatLayoutVersionId: Scalars['ID']['input'];
  vehicleId: Scalars['ID']['input'];
};

export type UserRole =
  | 'ADMIN'
  | 'CUSTOMER'
  | 'STAFF';



export type ResolverTypeWrapper<T> = Promise<T> | T;


export type ResolverWithResolve<TResult, TParent, TContext, TArgs> = {
  resolve: ResolverFn<TResult, TParent, TContext, TArgs>;
};
export type Resolver<TResult, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = ResolverFn<TResult, TParent, TContext, TArgs> | ResolverWithResolve<TResult, TParent, TContext, TArgs>;

export type ResolverFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => Promise<TResult> | TResult;

export type SubscriptionSubscribeFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => AsyncIterable<TResult> | Promise<AsyncIterable<TResult>>;

export type SubscriptionResolveFn<TResult, TParent, TContext, TArgs> = (
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;

export interface SubscriptionSubscriberObject<TResult, TKey extends string, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<{ [key in TKey]: TResult }, TParent, TContext, TArgs>;
  resolve?: SubscriptionResolveFn<TResult, { [key in TKey]: TResult }, TContext, TArgs>;
}

export interface SubscriptionResolverObject<TResult, TParent, TContext, TArgs> {
  subscribe: SubscriptionSubscribeFn<any, TParent, TContext, TArgs>;
  resolve: SubscriptionResolveFn<TResult, any, TContext, TArgs>;
}

export type SubscriptionObject<TResult, TKey extends string, TParent, TContext, TArgs> =
  | SubscriptionSubscriberObject<TResult, TKey, TParent, TContext, TArgs>
  | SubscriptionResolverObject<TResult, TParent, TContext, TArgs>;

export type SubscriptionResolver<TResult, TKey extends string, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> =
  | ((...args: any[]) => SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>)
  | SubscriptionObject<TResult, TKey, TParent, TContext, TArgs>;

export type TypeResolveFn<TTypes, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (
  parent: TParent,
  context: TContext,
  info: GraphQLResolveInfo
) => Maybe<TTypes> | Promise<Maybe<TTypes>>;

export type IsTypeOfResolverFn<T = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>> = (obj: T, context: TContext, info: GraphQLResolveInfo) => boolean | Promise<boolean>;

export type NextResolverFn<T> = () => Promise<T>;

export type DirectiveResolverFn<TResult = Record<PropertyKey, never>, TParent = Record<PropertyKey, never>, TContext = Record<PropertyKey, never>, TArgs = Record<PropertyKey, never>> = (
  next: NextResolverFn<TResult>,
  parent: TParent,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => TResult | Promise<TResult>;





/** Mapping between all available schema types and the resolvers types */
export type ResolversTypes = {
  AdminCatalog: ResolverTypeWrapper<AdminCatalog>;
  AdminLocation: ResolverTypeWrapper<AdminLocation>;
  AdminOperations: ResolverTypeWrapper<AdminOperations>;
  AdminOperationsInput: AdminOperationsInput;
  AdminOperator: ResolverTypeWrapper<AdminOperator>;
  AdminPaymentSummary: ResolverTypeWrapper<AdminPaymentSummary>;
  AdminPopularRoutes: ResolverTypeWrapper<AdminPopularRoutes>;
  AdminRevenueSummary: ResolverTypeWrapper<AdminRevenueSummary>;
  AdminRoute: ResolverTypeWrapper<AdminRoute>;
  AdminRouteOption: ResolverTypeWrapper<AdminRouteOption>;
  AdminRouteStop: ResolverTypeWrapper<AdminRouteStop>;
  AdminSearchConversion: ResolverTypeWrapper<AdminSearchConversion>;
  AdminSeatLayout: ResolverTypeWrapper<AdminSeatLayout>;
  AdminTicketSalesByRoute: ResolverTypeWrapper<AdminTicketSalesByRoute>;
  AdminTrip: ResolverTypeWrapper<AdminTrip>;
  AdminVehicle: ResolverTypeWrapper<AdminVehicle>;
  AdminVehicleOption: ResolverTypeWrapper<AdminVehicleOption>;
  AdminVehicleType: ResolverTypeWrapper<AdminVehicleType>;
  AnalyticsConsumerLag: ResolverTypeWrapper<AnalyticsConsumerLag>;
  AnalyticsDateRangeInput: AnalyticsDateRangeInput;
  AnalyticsTopicLag: ResolverTypeWrapper<AnalyticsTopicLag>;
  AuthSession: ResolverTypeWrapper<AuthSession>;
  AuthUser: ResolverTypeWrapper<AuthUser>;
  Booking: ResolverTypeWrapper<Booking>;
  BookingAuditEvent: ResolverTypeWrapper<BookingAuditEvent>;
  BookingConnection: ResolverTypeWrapper<BookingConnection>;
  BookingContact: ResolverTypeWrapper<BookingContact>;
  BookingContactInput: BookingContactInput;
  BookingLookup: ResolverTypeWrapper<BookingLookup>;
  BookingOperationalSummary: ResolverTypeWrapper<BookingOperationalSummary>;
  BookingPageInfo: ResolverTypeWrapper<BookingPageInfo>;
  BookingPassenger: ResolverTypeWrapper<BookingPassenger>;
  BookingPassengerInput: BookingPassengerInput;
  BookingStatus: BookingStatus;
  BookingStatusCount: ResolverTypeWrapper<BookingStatusCount>;
  BookingTicket: ResolverTypeWrapper<BookingTicket>;
  BookingTicketDelivery: ResolverTypeWrapper<BookingTicketDelivery>;
  BookingTripSnapshot: ResolverTypeWrapper<BookingTripSnapshot>;
  Boolean: ResolverTypeWrapper<Scalars['Boolean']['output']>;
  CancelBookingInput: CancelBookingInput;
  CancellationResult: ResolverTypeWrapper<CancellationResult>;
  CatalogResourceType: CatalogResourceType;
  CheckInResult: ResolverTypeWrapper<CheckInResult>;
  CheckInTicketInput: CheckInTicketInput;
  CreateBookingInput: CreateBookingInput;
  CreateTripInput: CreateTripInput;
  CreateTripResult: ResolverTypeWrapper<CreateTripResult>;
  DailyRevenue: ResolverTypeWrapper<DailyRevenue>;
  DeletePassengerProfilePayload: ResolverTypeWrapper<DeletePassengerProfilePayload>;
  Float: ResolverTypeWrapper<Scalars['Float']['output']>;
  HealthStatus: HealthStatus;
  HoldSeatsInput: HoldSeatsInput;
  HoldStatus: HoldStatus;
  ID: ResolverTypeWrapper<Scalars['ID']['output']>;
  Int: ResolverTypeWrapper<Scalars['Int']['output']>;
  LocationKind: LocationKind;
  LocationSuggestion: ResolverTypeWrapper<LocationSuggestion>;
  LoginInput: LoginInput;
  LogoutInput: LogoutInput;
  LogoutPayload: ResolverTypeWrapper<LogoutPayload>;
  Long: ResolverTypeWrapper<Scalars['Long']['output']>;
  Mutation: ResolverTypeWrapper<Record<PropertyKey, never>>;
  PassengerProfile: ResolverTypeWrapper<PassengerProfile>;
  PassengerProfileInput: PassengerProfileInput;
  PaymentResult: ResolverTypeWrapper<PaymentResult>;
  PaymentStatus: PaymentStatus;
  PlatformHealth: ResolverTypeWrapper<PlatformHealth>;
  PlatformPulse: ResolverTypeWrapper<PlatformPulse>;
  PolicyReference: ResolverTypeWrapper<PolicyReference>;
  PopularRoute: ResolverTypeWrapper<PopularRoute>;
  PopularRoutesInput: PopularRoutesInput;
  Query: ResolverTypeWrapper<Record<PropertyKey, never>>;
  RefreshSessionInput: RefreshSessionInput;
  ReleaseSeatHoldInput: ReleaseSeatHoldInput;
  ReleaseSeatHoldPayload: ResolverTypeWrapper<ReleaseSeatHoldPayload>;
  RouteTicketSales: ResolverTypeWrapper<RouteTicketSales>;
  SaveAdminLocationInput: SaveAdminLocationInput;
  SaveAdminRouteInput: SaveAdminRouteInput;
  SaveAdminRouteStopInput: SaveAdminRouteStopInput;
  SaveAdminSeatLayoutInput: SaveAdminSeatLayoutInput;
  SaveAdminVehicleInput: SaveAdminVehicleInput;
  SaveCatalogResourceResult: ResolverTypeWrapper<SaveCatalogResourceResult>;
  SearchTripsInput: SearchTripsInput;
  SeatDefinition: ResolverTypeWrapper<SeatDefinition>;
  SeatHold: ResolverTypeWrapper<SeatHold>;
  SeatLayout: ResolverTypeWrapper<SeatLayout>;
  SeatMap: ResolverTypeWrapper<SeatMap>;
  SeatState: ResolverTypeWrapper<SeatState>;
  SeatStatus: SeatStatus;
  SeatStatusEvent: ResolverTypeWrapper<SeatStatusEvent>;
  ServiceHealth: ResolverTypeWrapper<ServiceHealth>;
  SetCatalogResourceActiveInput: SetCatalogResourceActiveInput;
  SetSeatBlockedInput: SetSeatBlockedInput;
  SetSeatBlockedResult: ResolverTypeWrapper<SetSeatBlockedResult>;
  SetTripActiveInput: SetTripActiveInput;
  SimulatePaymentInput: SimulatePaymentInput;
  SimulatedPaymentOutcome: SimulatedPaymentOutcome;
  StaffTicketCheckInKind: StaffTicketCheckInKind;
  StaffTicketCredentialKind: StaffTicketCredentialKind;
  StaffTicketLookupInput: StaffTicketLookupInput;
  StaffTicketView: ResolverTypeWrapper<StaffTicketView>;
  String: ResolverTypeWrapper<Scalars['String']['output']>;
  Subscription: ResolverTypeWrapper<Record<PropertyKey, never>>;
  TransitionTripStatusInput: TransitionTripStatusInput;
  TripActivationResult: ResolverTypeWrapper<TripActivationResult>;
  TripDetail: ResolverTypeWrapper<TripDetail>;
  TripLifecycleTarget: TripLifecycleTarget;
  TripPreparationOptions: ResolverTypeWrapper<TripPreparationOptions>;
  TripSearchResult: ResolverTypeWrapper<TripSearchResult>;
  TripSort: TripSort;
  TripStatus: TripStatus;
  TripStatusTransitionResult: ResolverTypeWrapper<TripStatusTransitionResult>;
  TripStop: ResolverTypeWrapper<TripStop>;
  TripStopKind: TripStopKind;
  TripSummary: ResolverTypeWrapper<TripSummary>;
  UpdateAdminTripInput: UpdateAdminTripInput;
  UserRole: UserRole;
};

/** Mapping between all available schema types and the resolvers parents */
export type ResolversParentTypes = {
  AdminCatalog: AdminCatalog;
  AdminLocation: AdminLocation;
  AdminOperations: AdminOperations;
  AdminOperationsInput: AdminOperationsInput;
  AdminOperator: AdminOperator;
  AdminPaymentSummary: AdminPaymentSummary;
  AdminPopularRoutes: AdminPopularRoutes;
  AdminRevenueSummary: AdminRevenueSummary;
  AdminRoute: AdminRoute;
  AdminRouteOption: AdminRouteOption;
  AdminRouteStop: AdminRouteStop;
  AdminSearchConversion: AdminSearchConversion;
  AdminSeatLayout: AdminSeatLayout;
  AdminTicketSalesByRoute: AdminTicketSalesByRoute;
  AdminTrip: AdminTrip;
  AdminVehicle: AdminVehicle;
  AdminVehicleOption: AdminVehicleOption;
  AdminVehicleType: AdminVehicleType;
  AnalyticsConsumerLag: AnalyticsConsumerLag;
  AnalyticsDateRangeInput: AnalyticsDateRangeInput;
  AnalyticsTopicLag: AnalyticsTopicLag;
  AuthSession: AuthSession;
  AuthUser: AuthUser;
  Booking: Booking;
  BookingAuditEvent: BookingAuditEvent;
  BookingConnection: BookingConnection;
  BookingContact: BookingContact;
  BookingContactInput: BookingContactInput;
  BookingLookup: BookingLookup;
  BookingOperationalSummary: BookingOperationalSummary;
  BookingPageInfo: BookingPageInfo;
  BookingPassenger: BookingPassenger;
  BookingPassengerInput: BookingPassengerInput;
  BookingStatusCount: BookingStatusCount;
  BookingTicket: BookingTicket;
  BookingTicketDelivery: BookingTicketDelivery;
  BookingTripSnapshot: BookingTripSnapshot;
  Boolean: Scalars['Boolean']['output'];
  CancelBookingInput: CancelBookingInput;
  CancellationResult: CancellationResult;
  CheckInResult: CheckInResult;
  CheckInTicketInput: CheckInTicketInput;
  CreateBookingInput: CreateBookingInput;
  CreateTripInput: CreateTripInput;
  CreateTripResult: CreateTripResult;
  DailyRevenue: DailyRevenue;
  DeletePassengerProfilePayload: DeletePassengerProfilePayload;
  Float: Scalars['Float']['output'];
  HoldSeatsInput: HoldSeatsInput;
  ID: Scalars['ID']['output'];
  Int: Scalars['Int']['output'];
  LocationSuggestion: LocationSuggestion;
  LoginInput: LoginInput;
  LogoutInput: LogoutInput;
  LogoutPayload: LogoutPayload;
  Long: Scalars['Long']['output'];
  Mutation: Record<PropertyKey, never>;
  PassengerProfile: PassengerProfile;
  PassengerProfileInput: PassengerProfileInput;
  PaymentResult: PaymentResult;
  PlatformHealth: PlatformHealth;
  PlatformPulse: PlatformPulse;
  PolicyReference: PolicyReference;
  PopularRoute: PopularRoute;
  PopularRoutesInput: PopularRoutesInput;
  Query: Record<PropertyKey, never>;
  RefreshSessionInput: RefreshSessionInput;
  ReleaseSeatHoldInput: ReleaseSeatHoldInput;
  ReleaseSeatHoldPayload: ReleaseSeatHoldPayload;
  RouteTicketSales: RouteTicketSales;
  SaveAdminLocationInput: SaveAdminLocationInput;
  SaveAdminRouteInput: SaveAdminRouteInput;
  SaveAdminRouteStopInput: SaveAdminRouteStopInput;
  SaveAdminSeatLayoutInput: SaveAdminSeatLayoutInput;
  SaveAdminVehicleInput: SaveAdminVehicleInput;
  SaveCatalogResourceResult: SaveCatalogResourceResult;
  SearchTripsInput: SearchTripsInput;
  SeatDefinition: SeatDefinition;
  SeatHold: SeatHold;
  SeatLayout: SeatLayout;
  SeatMap: SeatMap;
  SeatState: SeatState;
  SeatStatusEvent: SeatStatusEvent;
  ServiceHealth: ServiceHealth;
  SetCatalogResourceActiveInput: SetCatalogResourceActiveInput;
  SetSeatBlockedInput: SetSeatBlockedInput;
  SetSeatBlockedResult: SetSeatBlockedResult;
  SetTripActiveInput: SetTripActiveInput;
  SimulatePaymentInput: SimulatePaymentInput;
  StaffTicketLookupInput: StaffTicketLookupInput;
  StaffTicketView: StaffTicketView;
  String: Scalars['String']['output'];
  Subscription: Record<PropertyKey, never>;
  TransitionTripStatusInput: TransitionTripStatusInput;
  TripActivationResult: TripActivationResult;
  TripDetail: TripDetail;
  TripPreparationOptions: TripPreparationOptions;
  TripSearchResult: TripSearchResult;
  TripStatusTransitionResult: TripStatusTransitionResult;
  TripStop: TripStop;
  TripSummary: TripSummary;
  UpdateAdminTripInput: UpdateAdminTripInput;
};

export type AdminCatalogResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminCatalog'] = ResolversParentTypes['AdminCatalog']> = {
  locations: Resolver<Array<ResolversTypes['AdminLocation']>, ParentType, ContextType>;
  operators: Resolver<Array<ResolversTypes['AdminOperator']>, ParentType, ContextType>;
  routes: Resolver<Array<ResolversTypes['AdminRoute']>, ParentType, ContextType>;
  seatLayouts: Resolver<Array<ResolversTypes['AdminSeatLayout']>, ParentType, ContextType>;
  trips: Resolver<Array<ResolversTypes['AdminTrip']>, ParentType, ContextType>;
  vehicleTypes: Resolver<Array<ResolversTypes['AdminVehicleType']>, ParentType, ContextType>;
  vehicles: Resolver<Array<ResolversTypes['AdminVehicle']>, ParentType, ContextType>;
};

export type AdminLocationResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminLocation'] = ResolversParentTypes['AdminLocation']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  kind: Resolver<ResolversTypes['LocationKind'], ParentType, ContextType>;
  name: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  parentLocationId: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
};

export type AdminOperationsResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminOperations'] = ResolversParentTypes['AdminOperations']> = {
  auditEvents: Resolver<Array<ResolversTypes['BookingAuditEvent']>, ParentType, ContextType>;
  bookings: Resolver<Array<ResolversTypes['Booking']>, ParentType, ContextType>;
  summary: Resolver<ResolversTypes['BookingOperationalSummary'], ParentType, ContextType>;
};

export type AdminOperatorResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminOperator'] = ResolversParentTypes['AdminOperator']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  name: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminPaymentSummaryResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminPaymentSummary'] = ResolversParentTypes['AdminPaymentSummary']> = {
  attemptCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  consumerLag: Resolver<ResolversTypes['AnalyticsConsumerLag'], ParentType, ContextType>;
  failedCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  lastProcessedAt: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  succeededAmountVnd: Resolver<ResolversTypes['Long'], ParentType, ContextType>;
  succeededCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  successRate: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminPopularRoutesResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminPopularRoutes'] = ResolversParentTypes['AdminPopularRoutes']> = {
  lastProcessedAt: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  routes: Resolver<Array<ResolversTypes['PopularRoute']>, ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminRevenueSummaryResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminRevenueSummary'] = ResolversParentTypes['AdminRevenueSummary']> = {
  days: Resolver<Array<ResolversTypes['DailyRevenue']>, ParentType, ContextType>;
  lastProcessedAt: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  paidBookingCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  ticketCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  totalRevenueVnd: Resolver<ResolversTypes['Long'], ParentType, ContextType>;
};

export type AdminRouteResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminRoute'] = ResolversParentTypes['AdminRoute']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  destinationLocationId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  durationMinutes: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  originLocationId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  stops: Resolver<Array<ResolversTypes['AdminRouteStop']>, ParentType, ContextType>;
};

export type AdminRouteOptionResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminRouteOption'] = ResolversParentTypes['AdminRouteOption']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  destinationName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  durationMinutes: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  originName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminRouteStopResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminRouteStop'] = ResolversParentTypes['AdminRouteStop']> = {
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  locationId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  offsetMinutes: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  stopKind: Resolver<ResolversTypes['TripStopKind'], ParentType, ContextType>;
  stopOrder: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type AdminSearchConversionResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminSearchConversion'] = ResolversParentTypes['AdminSearchConversion']> = {
  conversionRate: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  lastProcessedAt: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  paidBookingCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  searchCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminSeatLayoutResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminSeatLayout'] = ResolversParentTypes['AdminSeatLayout']> = {
  deckCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  layoutJson: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  name: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vehicleTypeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  version: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type AdminTicketSalesByRouteResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminTicketSalesByRoute'] = ResolversParentTypes['AdminTicketSalesByRoute']> = {
  lastProcessedAt: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  routes: Resolver<Array<ResolversTypes['RouteTicketSales']>, ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminTripResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminTrip'] = ResolversParentTypes['AdminTrip']> = {
  arrivalAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  departureAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  priceVnd: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  routeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['TripStatus'], ParentType, ContextType>;
  vehicleId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type AdminVehicleResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminVehicle'] = ResolversParentTypes['AdminVehicle']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  operatorId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  plate: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatLayoutVersionId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  vehicleTypeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type AdminVehicleOptionResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminVehicleOption'] = ResolversParentTypes['AdminVehicleOption']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  operatorName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  plate: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatLayoutName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatLayoutVersion: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  seatLayoutVersionId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  vehicleTypeName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AdminVehicleTypeResolvers<ContextType = any, ParentType extends ResolversParentTypes['AdminVehicleType'] = ResolversParentTypes['AdminVehicleType']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatCapacity: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type AnalyticsConsumerLagResolvers<ContextType = any, ParentType extends ResolversParentTypes['AnalyticsConsumerLag'] = ResolversParentTypes['AnalyticsConsumerLag']> = {
  available: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  topics: Resolver<Array<ResolversTypes['AnalyticsTopicLag']>, ParentType, ContextType>;
  totalLag: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type AnalyticsTopicLagResolvers<ContextType = any, ParentType extends ResolversParentTypes['AnalyticsTopicLag'] = ResolversParentTypes['AnalyticsTopicLag']> = {
  lag: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  topic: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type AuthSessionResolvers<ContextType = any, ParentType extends ResolversParentTypes['AuthSession'] = ResolversParentTypes['AuthSession']> = {
  accessExpiresAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  accessToken: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  refreshExpiresAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  refreshToken: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  user: Resolver<ResolversTypes['AuthUser'], ParentType, ContextType>;
};

export type AuthUserResolvers<ContextType = any, ParentType extends ResolversParentTypes['AuthUser'] = ResolversParentTypes['AuthUser']> = {
  displayName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  email: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  role: Resolver<ResolversTypes['UserRole'], ParentType, ContextType>;
};

export type BookingResolvers<ContextType = any, ParentType extends ResolversParentTypes['Booking'] = ResolversParentTypes['Booking']> = {
  bookingCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  contact: Resolver<ResolversTypes['BookingContact'], ParentType, ContextType>;
  createdAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  holdExpiresAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  passengers: Resolver<Array<ResolversTypes['BookingPassenger']>, ParentType, ContextType>;
  status: Resolver<ResolversTypes['BookingStatus'], ParentType, ContextType>;
  totalPriceVnd: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  trip: Resolver<ResolversTypes['BookingTripSnapshot'], ParentType, ContextType>;
};

export type BookingAuditEventResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingAuditEvent'] = ResolversParentTypes['BookingAuditEvent']> = {
  action: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  actorId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  actorRole: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  occurredAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  requestId: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  targetId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  targetType: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  traceId: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type BookingConnectionResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingConnection'] = ResolversParentTypes['BookingConnection']> = {
  nodes: Resolver<Array<ResolversTypes['Booking']>, ParentType, ContextType>;
  pageInfo: Resolver<ResolversTypes['BookingPageInfo'], ParentType, ContextType>;
};

export type BookingContactResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingContact'] = ResolversParentTypes['BookingContact']> = {
  email: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  fullName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  phone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type BookingLookupResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingLookup'] = ResolversParentTypes['BookingLookup']> = {
  bookingCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  cancellationEligible: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  departureAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  destinationName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  originName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatIds: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  status: Resolver<ResolversTypes['BookingStatus'], ParentType, ContextType>;
  ticketIssued: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type BookingOperationalSummaryResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingOperationalSummary'] = ResolversParentTypes['BookingOperationalSummary']> = {
  bookingCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  passengerCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  revenueVnd: Resolver<ResolversTypes['Long'], ParentType, ContextType>;
  statusCounts: Resolver<Array<ResolversTypes['BookingStatusCount']>, ParentType, ContextType>;
};

export type BookingPageInfoResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingPageInfo'] = ResolversParentTypes['BookingPageInfo']> = {
  endCursor: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  hasNextPage: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type BookingPassengerResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingPassenger'] = ResolversParentTypes['BookingPassenger']> = {
  fullName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  hasDocumentNumber: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  phone: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  seatId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type BookingStatusCountResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingStatusCount'] = ResolversParentTypes['BookingStatusCount']> = {
  count: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['BookingStatus'], ParentType, ContextType>;
};

export type BookingTicketResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingTicket'] = ResolversParentTypes['BookingTicket']> = {
  bookingCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  departureAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dropoffName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  htmlContent: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  issuedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  passengerName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pdfBase64: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pickupName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  qrPayload: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  routeLabel: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  ticketCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vehicleLabel: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type BookingTicketDeliveryResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingTicketDelivery'] = ResolversParentTypes['BookingTicketDelivery']> = {
  bookingId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  ready: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  tickets: Resolver<Array<ResolversTypes['BookingTicket']>, ParentType, ContextType>;
};

export type BookingTripSnapshotResolvers<ContextType = any, ParentType extends ResolversParentTypes['BookingTripSnapshot'] = ResolversParentTypes['BookingTripSnapshot']> = {
  arrivalAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  departureAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  destinationName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dropoffName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  operatorName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  originName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pickupName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  routeCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  routeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  unitPriceVnd: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  vehicleCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vehiclePlate: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vehicleTypeName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type CancellationResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['CancellationResult'] = ResolversParentTypes['CancellationResult']> = {
  booking: Resolver<ResolversTypes['Booking'], ParentType, ContextType>;
  cancelledAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  policyCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatsReleased: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type CheckInResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['CheckInResult'] = ResolversParentTypes['CheckInResult']> = {
  ticket: Resolver<ResolversTypes['StaffTicketView'], ParentType, ContextType>;
  transitioned: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export type CreateTripResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['CreateTripResult'] = ResolversParentTypes['CreateTripResult']> = {
  arrivalAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  created: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  createdAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  departureAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  priceVnd: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  routeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  seatLayoutVersionId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['TripStatus'], ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  vehicleId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type DailyRevenueResolvers<ContextType = any, ParentType extends ResolversParentTypes['DailyRevenue'] = ResolversParentTypes['DailyRevenue']> = {
  localDate: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  paidBookingCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  revenueVnd: Resolver<ResolversTypes['Long'], ParentType, ContextType>;
  ticketCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type DeletePassengerProfilePayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['DeletePassengerProfilePayload'] = ResolversParentTypes['DeletePassengerProfilePayload']> = {
  deleted: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type LocationSuggestionResolvers<ContextType = any, ParentType extends ResolversParentTypes['LocationSuggestion'] = ResolversParentTypes['LocationSuggestion']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind: Resolver<ResolversTypes['LocationKind'], ParentType, ContextType>;
  name: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  normalizedName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  parentLocationId: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
};

export type LogoutPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['LogoutPayload'] = ResolversParentTypes['LogoutPayload']> = {
  revoked: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
};

export interface LongScalarConfig extends GraphQLScalarTypeConfig<ResolversTypes['Long'], any> {
  name: 'Long';
}

export type MutationResolvers<ContextType = any, ParentType extends ResolversParentTypes['Mutation'] = ResolversParentTypes['Mutation']> = {
  cancelBooking: Resolver<ResolversTypes['CancellationResult'], ParentType, ContextType, RequireFields<MutationCancelBookingArgs, 'input'>>;
  checkInTicket: Resolver<ResolversTypes['CheckInResult'], ParentType, ContextType, RequireFields<MutationCheckInTicketArgs, 'input'>>;
  createBooking: Resolver<ResolversTypes['Booking'], ParentType, ContextType, RequireFields<MutationCreateBookingArgs, 'input'>>;
  createPassengerProfile: Resolver<ResolversTypes['PassengerProfile'], ParentType, ContextType, RequireFields<MutationCreatePassengerProfileArgs, 'input'>>;
  createTrip: Resolver<ResolversTypes['CreateTripResult'], ParentType, ContextType, RequireFields<MutationCreateTripArgs, 'input'>>;
  deletePassengerProfile: Resolver<ResolversTypes['DeletePassengerProfilePayload'], ParentType, ContextType, RequireFields<MutationDeletePassengerProfileArgs, 'id'>>;
  holdSeats: Resolver<ResolversTypes['SeatHold'], ParentType, ContextType, RequireFields<MutationHoldSeatsArgs, 'input'>>;
  login: Resolver<ResolversTypes['AuthSession'], ParentType, ContextType, RequireFields<MutationLoginArgs, 'input'>>;
  logout: Resolver<ResolversTypes['LogoutPayload'], ParentType, ContextType, RequireFields<MutationLogoutArgs, 'input'>>;
  refreshSession: Resolver<ResolversTypes['AuthSession'], ParentType, ContextType, RequireFields<MutationRefreshSessionArgs, 'input'>>;
  releaseSeatHold: Resolver<ResolversTypes['ReleaseSeatHoldPayload'], ParentType, ContextType, RequireFields<MutationReleaseSeatHoldArgs, 'input'>>;
  saveAdminLocation: Resolver<ResolversTypes['SaveCatalogResourceResult'], ParentType, ContextType, RequireFields<MutationSaveAdminLocationArgs, 'input'>>;
  saveAdminRoute: Resolver<ResolversTypes['SaveCatalogResourceResult'], ParentType, ContextType, RequireFields<MutationSaveAdminRouteArgs, 'input'>>;
  saveAdminSeatLayout: Resolver<ResolversTypes['SaveCatalogResourceResult'], ParentType, ContextType, RequireFields<MutationSaveAdminSeatLayoutArgs, 'input'>>;
  saveAdminVehicle: Resolver<ResolversTypes['SaveCatalogResourceResult'], ParentType, ContextType, RequireFields<MutationSaveAdminVehicleArgs, 'input'>>;
  setCatalogResourceActive: Resolver<ResolversTypes['SaveCatalogResourceResult'], ParentType, ContextType, RequireFields<MutationSetCatalogResourceActiveArgs, 'input'>>;
  setSeatBlocked: Resolver<ResolversTypes['SetSeatBlockedResult'], ParentType, ContextType, RequireFields<MutationSetSeatBlockedArgs, 'input'>>;
  setTripActive: Resolver<ResolversTypes['TripActivationResult'], ParentType, ContextType, RequireFields<MutationSetTripActiveArgs, 'input'>>;
  simulatePayment: Resolver<ResolversTypes['PaymentResult'], ParentType, ContextType, RequireFields<MutationSimulatePaymentArgs, 'input'>>;
  transitionTripStatus: Resolver<ResolversTypes['TripStatusTransitionResult'], ParentType, ContextType, RequireFields<MutationTransitionTripStatusArgs, 'input'>>;
  updateAdminTrip: Resolver<ResolversTypes['SaveCatalogResourceResult'], ParentType, ContextType, RequireFields<MutationUpdateAdminTripArgs, 'input'>>;
  updatePassengerProfile: Resolver<ResolversTypes['PassengerProfile'], ParentType, ContextType, RequireFields<MutationUpdatePassengerProfileArgs, 'id' | 'input'>>;
};

export type PassengerProfileResolvers<ContextType = any, ParentType extends ResolversParentTypes['PassengerProfile'] = ResolversParentTypes['PassengerProfile']> = {
  createdAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  fullName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  label: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  phone: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  updatedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type PaymentResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['PaymentResult'] = ResolversParentTypes['PaymentResult']> = {
  booking: Resolver<ResolversTypes['Booking'], ParentType, ContextType>;
  failureCode: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  paymentAttemptId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  processedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['PaymentStatus'], ParentType, ContextType>;
};

export type PlatformHealthResolvers<ContextType = any, ParentType extends ResolversParentTypes['PlatformHealth'] = ResolversParentTypes['PlatformHealth']> = {
  checkedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  service: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['HealthStatus'], ParentType, ContextType>;
  version: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type PlatformPulseResolvers<ContextType = any, ParentType extends ResolversParentTypes['PlatformPulse'] = ResolversParentTypes['PlatformPulse']> = {
  emittedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  sequence: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  service: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['HealthStatus'], ParentType, ContextType>;
};

export type PolicyReferenceResolvers<ContextType = any, ParentType extends ResolversParentTypes['PolicyReference'] = ResolversParentTypes['PolicyReference']> = {
  code: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  resourceUri: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  summary: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  title: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type PopularRouteResolvers<ContextType = any, ParentType extends ResolversParentTypes['PopularRoute'] = ResolversParentTypes['PopularRoute']> = {
  conversionRate: Resolver<ResolversTypes['Float'], ParentType, ContextType>;
  paidBookingCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  routeCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  routeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  routeLabel: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  searchCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type QueryResolvers<ContextType = any, ParentType extends ResolversParentTypes['Query'] = ResolversParentTypes['Query']> = {
  adminCatalog: Resolver<ResolversTypes['AdminCatalog'], ParentType, ContextType>;
  adminOperations: Resolver<ResolversTypes['AdminOperations'], ParentType, ContextType, RequireFields<QueryAdminOperationsArgs, 'input'>>;
  adminPaymentSummary: Resolver<ResolversTypes['AdminPaymentSummary'], ParentType, ContextType, RequireFields<QueryAdminPaymentSummaryArgs, 'input'>>;
  adminPopularRoutes: Resolver<ResolversTypes['AdminPopularRoutes'], ParentType, ContextType, RequireFields<QueryAdminPopularRoutesArgs, 'input'>>;
  adminRevenueSummary: Resolver<ResolversTypes['AdminRevenueSummary'], ParentType, ContextType, RequireFields<QueryAdminRevenueSummaryArgs, 'input'>>;
  adminSearchConversion: Resolver<ResolversTypes['AdminSearchConversion'], ParentType, ContextType, RequireFields<QueryAdminSearchConversionArgs, 'input'>>;
  adminTicketSalesByRoute: Resolver<ResolversTypes['AdminTicketSalesByRoute'], ParentType, ContextType, RequireFields<QueryAdminTicketSalesByRouteArgs, 'input'>>;
  adminTripPreparationOptions: Resolver<ResolversTypes['TripPreparationOptions'], ParentType, ContextType>;
  bookingLookup: Resolver<ResolversTypes['BookingLookup'], ParentType, ContextType, RequireFields<QueryBookingLookupArgs, 'bookingCode' | 'email'>>;
  bookingTickets: Resolver<ResolversTypes['BookingTicketDelivery'], ParentType, ContextType, RequireFields<QueryBookingTicketsArgs, 'bookingId'>>;
  catalogHealth: Resolver<ResolversTypes['ServiceHealth'], ParentType, ContextType>;
  locationSuggestions: Resolver<Array<ResolversTypes['LocationSuggestion']>, ParentType, ContextType, RequireFields<QueryLocationSuggestionsArgs, 'limit' | 'query'>>;
  myBookings: Resolver<ResolversTypes['BookingConnection'], ParentType, ContextType, RequireFields<QueryMyBookingsArgs, 'first'>>;
  passengerProfiles: Resolver<Array<ResolversTypes['PassengerProfile']>, ParentType, ContextType>;
  platformHealth: Resolver<ResolversTypes['PlatformHealth'], ParentType, ContextType>;
  searchTrips: Resolver<ResolversTypes['TripSearchResult'], ParentType, ContextType, RequireFields<QuerySearchTripsArgs, 'input'>>;
  seatHold: Resolver<ResolversTypes['SeatHold'], ParentType, ContextType, RequireFields<QuerySeatHoldArgs, 'holdToken'>>;
  seatMap: Resolver<ResolversTypes['SeatMap'], ParentType, ContextType, RequireFields<QuerySeatMapArgs, 'tripId'>>;
  staffTicketLookup: Resolver<Array<ResolversTypes['StaffTicketView']>, ParentType, ContextType, RequireFields<QueryStaffTicketLookupArgs, 'input'>>;
  trip: Resolver<Maybe<ResolversTypes['TripDetail']>, ParentType, ContextType, RequireFields<QueryTripArgs, 'id'>>;
  viewer: Resolver<ResolversTypes['AuthUser'], ParentType, ContextType>;
};

export type ReleaseSeatHoldPayloadResolvers<ContextType = any, ParentType extends ResolversParentTypes['ReleaseSeatHoldPayload'] = ResolversParentTypes['ReleaseSeatHoldPayload']> = {
  released: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  releasedAt: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  seatIds: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  tripId: Resolver<Maybe<ResolversTypes['ID']>, ParentType, ContextType>;
};

export type RouteTicketSalesResolvers<ContextType = any, ParentType extends ResolversParentTypes['RouteTicketSales'] = ResolversParentTypes['RouteTicketSales']> = {
  paidBookingCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  revenueVnd: Resolver<ResolversTypes['Long'], ParentType, ContextType>;
  routeCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  routeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  routeLabel: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ticketCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type SaveCatalogResourceResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['SaveCatalogResourceResult'] = ResolversParentTypes['SaveCatalogResourceResult']> = {
  changed: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  created: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  isActive: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  resourceType: Resolver<ResolversTypes['CatalogResourceType'], ParentType, ContextType>;
  updatedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type SeatDefinitionResolvers<ContextType = any, ParentType extends ResolversParentTypes['SeatDefinition'] = ResolversParentTypes['SeatDefinition']> = {
  column: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  deck: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  label: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  row: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type SeatHoldResolvers<ContextType = any, ParentType extends ResolversParentTypes['SeatHold'] = ResolversParentTypes['SeatHold']> = {
  expiresAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  remainingTtlSeconds: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  seatIds: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  status: Resolver<ResolversTypes['HoldStatus'], ParentType, ContextType>;
  token: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  totalPriceVnd: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  unitPriceVnd: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type SeatLayoutResolvers<ContextType = any, ParentType extends ResolversParentTypes['SeatLayout'] = ResolversParentTypes['SeatLayout']> = {
  deckCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seats: Resolver<Array<ResolversTypes['SeatDefinition']>, ParentType, ContextType>;
  version: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type SeatMapResolvers<ContextType = any, ParentType extends ResolversParentTypes['SeatMap'] = ResolversParentTypes['SeatMap']> = {
  deckCount: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  generatedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  layoutId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  layoutName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  layoutVersion: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  seats: Resolver<Array<ResolversTypes['SeatState']>, ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type SeatStateResolvers<ContextType = any, ParentType extends ResolversParentTypes['SeatState'] = ResolversParentTypes['SeatState']> = {
  column: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  deck: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  heldByRequester: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  label: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  row: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['SeatStatus'], ParentType, ContextType>;
};

export type SeatStatusEventResolvers<ContextType = any, ParentType extends ResolversParentTypes['SeatStatusEvent'] = ResolversParentTypes['SeatStatusEvent']> = {
  expiresAt: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  occurredAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatIds: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  status: Resolver<ResolversTypes['SeatStatus'], ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  version: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type ServiceHealthResolvers<ContextType = any, ParentType extends ResolversParentTypes['ServiceHealth'] = ResolversParentTypes['ServiceHealth']> = {
  checkedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  requestId: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  service: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['HealthStatus'], ParentType, ContextType>;
  traceId: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  version: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type SetSeatBlockedResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['SetSeatBlockedResult'] = ResolversParentTypes['SetSeatBlockedResult']> = {
  blocked: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  changed: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  seatIds: Resolver<Array<ResolversTypes['ID']>, ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  updatedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type StaffTicketViewResolvers<ContextType = any, ParentType extends ResolversParentTypes['StaffTicketView'] = ResolversParentTypes['StaffTicketView']> = {
  bookingCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  bookingId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  bookingStatus: Resolver<ResolversTypes['BookingStatus'], ParentType, ContextType>;
  checkedInAt: Resolver<Maybe<ResolversTypes['String']>, ParentType, ContextType>;
  departureAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  passengerId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  passengerName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  routeLabel: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  seatId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  ticketCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  ticketId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type SubscriptionResolvers<ContextType = any, ParentType extends ResolversParentTypes['Subscription'] = ResolversParentTypes['Subscription']> = {
  platformPulse: SubscriptionResolver<ResolversTypes['PlatformPulse'], "platformPulse", ParentType, ContextType>;
  seatStatusChanged: SubscriptionResolver<ResolversTypes['SeatStatusEvent'], "seatStatusChanged", ParentType, ContextType, RequireFields<SubscriptionSeatStatusChangedArgs, 'tripId'>>;
};

export type TripActivationResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['TripActivationResult'] = ResolversParentTypes['TripActivationResult']> = {
  changed: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  isActive: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type TripDetailResolvers<ContextType = any, ParentType extends ResolversParentTypes['TripDetail'] = ResolversParentTypes['TripDetail']> = {
  arrivalAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  departureAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  destinationName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  durationMinutes: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  operatorName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  originName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  policies: Resolver<Array<ResolversTypes['PolicyReference']>, ParentType, ContextType>;
  priceVnd: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  remainingSeats: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  routeCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  routeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  seatLayout: Resolver<ResolversTypes['SeatLayout'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['TripStatus'], ParentType, ContextType>;
  stops: Resolver<Array<ResolversTypes['TripStop']>, ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vehicleCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vehiclePlate: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vehicleTypeName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type TripPreparationOptionsResolvers<ContextType = any, ParentType extends ResolversParentTypes['TripPreparationOptions'] = ResolversParentTypes['TripPreparationOptions']> = {
  routes: Resolver<Array<ResolversTypes['AdminRouteOption']>, ParentType, ContextType>;
  vehicles: Resolver<Array<ResolversTypes['AdminVehicleOption']>, ParentType, ContextType>;
};

export type TripSearchResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['TripSearchResult'] = ResolversParentTypes['TripSearchResult']> = {
  nearestTravelDates: Resolver<Array<ResolversTypes['String']>, ParentType, ContextType>;
  timezone: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  trips: Resolver<Array<ResolversTypes['TripSummary']>, ParentType, ContextType>;
};

export type TripStatusTransitionResultResolvers<ContextType = any, ParentType extends ResolversParentTypes['TripStatusTransitionResult'] = ResolversParentTypes['TripStatusTransitionResult']> = {
  changed: Resolver<ResolversTypes['Boolean'], ParentType, ContextType>;
  previousStatus: Resolver<ResolversTypes['TripStatus'], ParentType, ContextType>;
  status: Resolver<ResolversTypes['TripStatus'], ParentType, ContextType>;
  transitionedAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  tripId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
};

export type TripStopResolvers<ContextType = any, ParentType extends ResolversParentTypes['TripStop'] = ResolversParentTypes['TripStop']> = {
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  kind: Resolver<ResolversTypes['TripStopKind'], ParentType, ContextType>;
  locationId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  name: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  offsetMinutes: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  scheduledAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  stopOrder: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
};

export type TripSummaryResolvers<ContextType = any, ParentType extends ResolversParentTypes['TripSummary'] = ResolversParentTypes['TripSummary']> = {
  arrivalAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  departureAt: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  destinationName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  dropoffName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  durationMinutes: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  id: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  operatorName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  originName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  pickupName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  priceVnd: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  remainingSeats: Resolver<ResolversTypes['Int'], ParentType, ContextType>;
  routeId: Resolver<ResolversTypes['ID'], ParentType, ContextType>;
  vehicleCode: Resolver<ResolversTypes['String'], ParentType, ContextType>;
  vehicleTypeName: Resolver<ResolversTypes['String'], ParentType, ContextType>;
};

export type Resolvers<ContextType = any> = {
  AdminCatalog: AdminCatalogResolvers<ContextType>;
  AdminLocation: AdminLocationResolvers<ContextType>;
  AdminOperations: AdminOperationsResolvers<ContextType>;
  AdminOperator: AdminOperatorResolvers<ContextType>;
  AdminPaymentSummary: AdminPaymentSummaryResolvers<ContextType>;
  AdminPopularRoutes: AdminPopularRoutesResolvers<ContextType>;
  AdminRevenueSummary: AdminRevenueSummaryResolvers<ContextType>;
  AdminRoute: AdminRouteResolvers<ContextType>;
  AdminRouteOption: AdminRouteOptionResolvers<ContextType>;
  AdminRouteStop: AdminRouteStopResolvers<ContextType>;
  AdminSearchConversion: AdminSearchConversionResolvers<ContextType>;
  AdminSeatLayout: AdminSeatLayoutResolvers<ContextType>;
  AdminTicketSalesByRoute: AdminTicketSalesByRouteResolvers<ContextType>;
  AdminTrip: AdminTripResolvers<ContextType>;
  AdminVehicle: AdminVehicleResolvers<ContextType>;
  AdminVehicleOption: AdminVehicleOptionResolvers<ContextType>;
  AdminVehicleType: AdminVehicleTypeResolvers<ContextType>;
  AnalyticsConsumerLag: AnalyticsConsumerLagResolvers<ContextType>;
  AnalyticsTopicLag: AnalyticsTopicLagResolvers<ContextType>;
  AuthSession: AuthSessionResolvers<ContextType>;
  AuthUser: AuthUserResolvers<ContextType>;
  Booking: BookingResolvers<ContextType>;
  BookingAuditEvent: BookingAuditEventResolvers<ContextType>;
  BookingConnection: BookingConnectionResolvers<ContextType>;
  BookingContact: BookingContactResolvers<ContextType>;
  BookingLookup: BookingLookupResolvers<ContextType>;
  BookingOperationalSummary: BookingOperationalSummaryResolvers<ContextType>;
  BookingPageInfo: BookingPageInfoResolvers<ContextType>;
  BookingPassenger: BookingPassengerResolvers<ContextType>;
  BookingStatusCount: BookingStatusCountResolvers<ContextType>;
  BookingTicket: BookingTicketResolvers<ContextType>;
  BookingTicketDelivery: BookingTicketDeliveryResolvers<ContextType>;
  BookingTripSnapshot: BookingTripSnapshotResolvers<ContextType>;
  CancellationResult: CancellationResultResolvers<ContextType>;
  CheckInResult: CheckInResultResolvers<ContextType>;
  CreateTripResult: CreateTripResultResolvers<ContextType>;
  DailyRevenue: DailyRevenueResolvers<ContextType>;
  DeletePassengerProfilePayload: DeletePassengerProfilePayloadResolvers<ContextType>;
  LocationSuggestion: LocationSuggestionResolvers<ContextType>;
  LogoutPayload: LogoutPayloadResolvers<ContextType>;
  Long: GraphQLScalarType;
  Mutation: MutationResolvers<ContextType>;
  PassengerProfile: PassengerProfileResolvers<ContextType>;
  PaymentResult: PaymentResultResolvers<ContextType>;
  PlatformHealth: PlatformHealthResolvers<ContextType>;
  PlatformPulse: PlatformPulseResolvers<ContextType>;
  PolicyReference: PolicyReferenceResolvers<ContextType>;
  PopularRoute: PopularRouteResolvers<ContextType>;
  Query: QueryResolvers<ContextType>;
  ReleaseSeatHoldPayload: ReleaseSeatHoldPayloadResolvers<ContextType>;
  RouteTicketSales: RouteTicketSalesResolvers<ContextType>;
  SaveCatalogResourceResult: SaveCatalogResourceResultResolvers<ContextType>;
  SeatDefinition: SeatDefinitionResolvers<ContextType>;
  SeatHold: SeatHoldResolvers<ContextType>;
  SeatLayout: SeatLayoutResolvers<ContextType>;
  SeatMap: SeatMapResolvers<ContextType>;
  SeatState: SeatStateResolvers<ContextType>;
  SeatStatusEvent: SeatStatusEventResolvers<ContextType>;
  ServiceHealth: ServiceHealthResolvers<ContextType>;
  SetSeatBlockedResult: SetSeatBlockedResultResolvers<ContextType>;
  StaffTicketView: StaffTicketViewResolvers<ContextType>;
  Subscription: SubscriptionResolvers<ContextType>;
  TripActivationResult: TripActivationResultResolvers<ContextType>;
  TripDetail: TripDetailResolvers<ContextType>;
  TripPreparationOptions: TripPreparationOptionsResolvers<ContextType>;
  TripSearchResult: TripSearchResultResolvers<ContextType>;
  TripStatusTransitionResult: TripStatusTransitionResultResolvers<ContextType>;
  TripStop: TripStopResolvers<ContextType>;
  TripSummary: TripSummaryResolvers<ContextType>;
};


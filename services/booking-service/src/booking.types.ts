export type CheckoutOwnerType = 'GUEST_SESSION' | 'CUSTOMER';
export type BookingStatus =
  | 'DRAFT'
  | 'PENDING_PAYMENT'
  | 'PAID'
  | 'TICKET_ISSUED'
  | 'CHECKED_IN'
  | 'COMPLETED'
  | 'EXPIRED'
  | 'CANCELLED';

export interface CheckoutOwner {
  type: CheckoutOwnerType;
  id: string;
}

export interface BookingActor {
  type: CheckoutOwnerType | 'SYSTEM';
  id: string;
}

export interface BookingContact {
  fullName: string;
  email: string;
  phone: string;
}

export interface BookingPassengerInput {
  seatId: string;
  fullName: string;
  phone?: string;
  documentNumber?: string;
}

export interface BookingPassenger {
  id: string;
  seatId: string;
  fullName: string;
  phone?: string;
  hasDocumentNumber: boolean;
}

export interface BookingTripSnapshot {
  tripId: string;
  routeId: string;
  routeCode: string;
  operatorName: string;
  vehicleTypeName: string;
  vehicleCode: string;
  vehiclePlate: string;
  originName: string;
  destinationName: string;
  pickupName: string;
  dropoffName: string;
  departureAt: string;
  arrivalAt: string;
  timezone: string;
  unitPriceVnd: number;
}

export interface BookingView {
  id: string;
  bookingCode: string;
  status: BookingStatus;
  trip: BookingTripSnapshot;
  contact: BookingContact;
  passengers: BookingPassenger[];
  totalPriceVnd: number;
  holdExpiresAt: string;
  createdAt: string;
}

export interface GuestBookingLookup {
  bookingCode: string;
  status: BookingStatus;
  tripId: string;
  originName: string;
  destinationName: string;
  departureAt: string;
  timezone: string;
  seatIds: string[];
  ticketIssued: boolean;
  cancellationEligible: boolean;
}

export interface BookingPaymentRecord {
  booking: BookingView;
  holdToken: string;
  paidPaymentAttemptId?: string;
  paymentIdempotencyKey?: string;
  paidAt?: string;
  cancelledAt?: string;
  cancellationIdempotencyKey?: string;
  cancellationPolicyCode?: 'BEFORE_DEPARTURE_FULL_RELEASE';
  cancellationSeatsReleasedAt?: string;
}

export interface BookingFulfillmentSnapshot {
  booking: BookingView;
  owner: CheckoutOwner;
  paidAt: string;
}

export interface IssuedTicketReference {
  ticketId: string;
  passengerId: string;
  ticketCode: string;
  qrPayload: string;
}

export type StaffTicketCredentialKind = 'BOOKING_CODE' | 'TICKET_CODE' | 'QR_PAYLOAD';

export interface StaffActor {
  id: string;
  role: 'STAFF' | 'ADMIN';
}

export interface StaffTicketView {
  ticketId: string;
  ticketCode: string;
  bookingId: string;
  bookingCode: string;
  bookingStatus: BookingStatus;
  passengerId: string;
  passengerName: string;
  seatId: string;
  tripId: string;
  routeLabel: string;
  departureAt: string;
  checkedInAt?: string;
}

export interface BookingStatusCount {
  status: BookingStatus;
  count: number;
}

export interface BookingOperationalSummary {
  bookingCount: number;
  passengerCount: number;
  revenueVnd: number;
  statusCounts: BookingStatusCount[];
}

export interface BookingAuditEvent {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorId: string;
  actorRole: StaffActor['role'] | BookingActor['type'];
  occurredAt: string;
  requestId: string;
  traceId: string;
}

export interface BookingHistoryCursor {
  createdAt: string;
  id: string;
}

export interface CreateBookingRequest {
  holdToken?: string;
  owner?: CheckoutOwner;
  contact?: Partial<BookingContact>;
  passengers?: Array<Partial<BookingPassengerInput>>;
  idempotencyKey?: string;
  requestId?: string;
}

export interface ValidatedCreateBookingRequest {
  holdToken: string;
  owner: CheckoutOwner;
  contact: BookingContact;
  normalizedEmail: string;
  passengers: BookingPassengerInput[];
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface PersistBookingInput {
  id: string;
  bookingCode: string;
  owner: CheckoutOwner;
  idempotencyKey: string;
  requestFingerprint: string;
  holdToken: string;
  holdExpiresAt: string;
  contact: BookingContact;
  normalizedEmail: string;
  trip: BookingTripSnapshot;
  passengers: Array<
    BookingPassengerInput & {
      id: string;
      documentNumberHash?: string;
    }
  >;
  totalPriceVnd: number;
  createdAt: string;
}

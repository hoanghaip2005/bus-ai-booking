export type TicketOwnerType = 'GUEST_SESSION' | 'CUSTOMER';

export interface TicketOwner {
  type: TicketOwnerType;
  id: string;
}

export interface FulfillmentPassenger {
  id: string;
  seatId: string;
  fullName: string;
}

export interface FulfillmentSnapshot {
  bookingId: string;
  bookingCode: string;
  status: 'PAID' | 'TICKET_ISSUED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED';
  owner: TicketOwner;
  contactEmail: string;
  trip: {
    routeCode: string;
    originName: string;
    destinationName: string;
    pickupName: string;
    dropoffName: string;
    departureAt: string;
    timezone: string;
    vehicleCode: string;
    vehiclePlate: string;
  };
  passengers: FulfillmentPassenger[];
  totalPriceVnd: number;
  paidAt: string;
}

export interface GeneratedTicket {
  id: string;
  bookingId: string;
  passengerId: string;
  owner: TicketOwner;
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
  pdfDocument: Buffer;
  issuedAt: string;
}

export interface IssuedTicketReference {
  ticketId: string;
  passengerId: string;
  ticketCode: string;
  qrPayload: string;
}

export type TicketDocumentView = Omit<GeneratedTicket, 'passengerId' | 'owner'>;

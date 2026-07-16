# Contract Catalog

This document defines the initial public surface. Exact schemas are created in
Milestone 0 and must keep these semantics.

## GraphQL operations

### Queries

- `viewer: AuthUser!` (requires `Authorization: Bearer <access-token>`)
- `locationSuggestions(query: String!, limit: Int! = 8): [LocationSuggestion!]!`
- `searchTrips(input: SearchTripsInput!): TripSearchResult!`
- `trip(id: ID!): Trip!`
- `seatMap(tripId: ID!, holdToken: String): SeatMap!`
- `seatHold(holdToken: String!): SeatHold!`
- `bookingTickets(bookingId: ID!): BookingTicketDelivery!`
- `bookingLookup(bookingCode: String!, email: String!): BookingLookup!`
- `myBookings(first: Int! = 10, after: String): BookingConnection!`
- `adminBookings(filter: AdminBookingFilter, page: PageInput): BookingConnection!`
- `staffTicketLookup(input: StaffTicketLookupInput!): [StaffTicketView!]!`
- `revenueSummary(input: RevenueSummaryInput!): RevenueSummary!`
- `popularRoutes(input: PopularRoutesInput!): [PopularRoute!]!`

### Mutations

- `login(input: LoginInput!): AuthSession!`
- `refreshSession(input: RefreshSessionInput!): AuthSession!`
- `logout(input: LogoutInput!): LogoutPayload!`
- `setTripActive(input: SetTripActiveInput!): TripActivationResult!`
- `holdSeats(input: HoldSeatsInput!): SeatHold!`
- `releaseSeatHold(input: ReleaseSeatHoldInput!): ReleaseSeatHoldPayload!`
- `createBooking(input: CreateBookingInput!): Booking!`
- `simulatePayment(input: SimulatePaymentInput!): PaymentResult!`
- `cancelBooking(input: CancelBookingInput!): Booking!`
- `checkInTicket(input: CheckInTicketInput!): CheckInResult!`
- Admin CRUD mutations for location, stop, route, vehicle, layout, trip, fare,
  activation, trip lifecycle, and seat block.

Milestone 5 exposes `createTrip`, `setTripActive`, `transitionTripStatus`, and
`setSeatBlocked`. `createTrip` derives the immutable seat-layout version from
the selected vehicle and commits the scheduled trip, integer-VND fare,
idempotency record, and Catalog audit atomically. Seat block commands accept
only trip/seat identifiers, desired state, reason, and an idempotency key;
actor identity always comes from authenticated metadata.

### Subscriptions

- `platformPulse: PlatformPulse!` (foundation transport smoke; not a domain event)
- `seatStatusChanged(tripId: ID!): SeatStatusEvent!`

Subscriptions use the `graphql-transport-ws` protocol implemented by
`graphql-ws`; the deprecated `subscriptions-transport-ws` protocol is not
enabled.

Subscription payloads contain `tripId`, `seatIds`, effective status, optional
expiry, version, and event time. They never expose another customer's hold token.

`bookingTickets` is the M3.4 eventual-delivery read. The Gateway derives a
`GUEST_SESSION` owner from `x-checkout-session-id` and calls Ticket Service over
gRPC. The response has `ready` plus zero or more owner-scoped tickets containing
HTML and base64 PDF content; another checkout session receives no ticket data.

### GraphQL errors

Errors use `extensions.code` with stable values including:

- `VALIDATION_ERROR`
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `SEAT_UNAVAILABLE`
- `HOLD_EXPIRED`
- `IDEMPOTENCY_CONFLICT`
- `INVALID_STATE_TRANSITION`
- `PAYMENT_FAILED`
- `RATE_LIMITED`
- `DEPENDENCY_UNAVAILABLE`

## gRPC services

### IdentityService

- `Health`
- `Login`
- `Refresh`
- `Logout`
- `ValidateAccessToken`
- `ListPassengerProfiles`
- `CreatePassengerProfile`
- `UpdatePassengerProfile`
- `DeletePassengerProfile`

`Login` returns one neutral `UNAUTHENTICATED` failure for unknown users and
incorrect passwords. `Refresh` always rotates its opaque token; rotated,
revoked or expired tokens are rejected. `Logout` reports whether an active
refresh session was revoked.

`ValidateAccessToken` validates signature, issuer, audience, expiry, subject,
role, token ID, and the Identity-private issuing-session claim. It then rechecks
that the owning user is active, still has the claimed role, and that the issuing
refresh session belongs to that user, is unexpired, and has not been revoked.
Logout and refresh rotation therefore invalidate the replaced access token
immediately. Public GraphQL and MCP authentication use the HTTP Authorization
header; access tokens are never GraphQL or MCP tool arguments.

Passenger-profile methods require authenticated `CUSTOMER` actor metadata
(`x-actor-id`, `x-actor-role`, `x-actor-token-id`). Requests never accept a user
or owner ID. Identity scopes list, update and delete by the actor ID; a profile
owned by another customer returns the same `NOT_FOUND` result as an unknown ID.
Create/update accept `label`, `fullName` and optional normalized `phone`, with a
maximum of 20 profiles and a case-insensitive unique label per customer.
Identity-document numbers are intentionally absent from these contracts.

The matching GraphQL surface is `passengerProfiles`,
`createPassengerProfile(input)`, `updatePassengerProfile(id, input)` and
`deletePassengerProfile(id)`. Gateway requires the `CUSTOMER` role and forwards
actor metadata to Identity. Selecting a profile in checkout only prefills the
booking input; the resulting Booking passenger is an independent snapshot.

### CatalogQueryService

- `SuggestLocations`
- `SearchTrips`
- `GetTrip`
- `GetRoutePolicyContext`
- admin catalog commands may be split into `CatalogAdminService`

`SuggestLocations` accepts a trimmed query, a limit from 1 to 20, and the
request correlation ID. Results expose the stable location ID/code, display and
normalized names, `CITY` or `STATION` kind, and an optional parent city ID for a
station. Matching uses normalized Vietnamese names and aliases; the service,
not the Gateway, owns ranking and PostgreSQL access.

`SearchTrips` accepts origin and destination location IDs, a local travel date
in `YYYY-MM-DD`, and the request correlation ID. A station resolves to its
parent city before route matching. Results expose UTC departure/arrival
timestamps, operator, vehicle type/code, pickup/dropoff, integer VND fare,
duration and remaining seats. The response declares `Asia/Ho_Chi_Minh` as the
presentation timezone. Until Seat Inventory is introduced in Milestone 2,
remaining seats equal the vehicle capacity because no holds or sales exist;
Catalog does not persist live seat availability.

The request may carry a privacy-safe `searchSessionId` UUID generated at the
web/Gateway boundary. Catalog uses it only as the Kafka partition key and
analytics correlation field; it must not contain account, email, or booking data.

The Gateway adds an opaque UUID `searchSessionId` to the gRPC request from the
validated `x-search-session-id` HTTP header, or generates one when absent. This
identifier is analytics correlation metadata, not a GraphQL search filter and
must not contain account, email, device, or booking data.

Optional `SearchTrips` filters cover local departure-time bounds, integer VND
price bounds, operator codes, vehicle-type codes and minimum remaining seats.
Sort values are `DEPARTURE_EARLIEST`, `PRICE_LOWEST` and
`DURATION_SHORTEST`. When the filtered result is empty, the response includes
up to three nearest local travel dates that satisfy the same route and filters.
Filter values remain URL-shareable in the web client and every SQL value is a
parameter; sort enums only select predefined ordering expressions.

`GetTrip` accepts a UUID trip ID and returns only active `SCHEDULED` or
`BOARDING` trips. The detail contains the route and vehicle snapshot, UTC
departure/arrival timestamps, ordered stops with calculated UTC schedule,
integer VND fare, the assigned immutable seat-layout version, and versioned
policy resource references. Unknown, inactive, departed, completed, or
cancelled trips return gRPC `NOT_FOUND`; the Gateway exposes the same condition
as GraphQL `extensions.code = NOT_FOUND` without leaking whether a hidden trip
exists.

The GraphQL `trip(id)` response adds `timezone = Asia/Ho_Chi_Minh` for display.
Seat definitions are read-only in Milestone 1; realtime availability remains
owned by Seat Inventory from Milestone 2.

`CatalogAdminService.SetTripActive` is exposed through the authenticated
GraphQL `setTripActive` proof operation in M4.1. It
requires propagated `x-actor-role = ADMIN`, returns whether PostgreSQL state
changed, and advances the Redis search-cache generation even for an idempotent
retry so a prior post-commit Redis failure can be healed. Catalog also requires
valid `x-actor-id` and `x-actor-token-id` UUID metadata and therefore does not
trust the Gateway role check alone.

### CatalogAdminService

- `SetTripActive`
- `TransitionTripStatus`
- `ListTripPreparationOptions`
- `CreateTrip`
- `GetAdminCatalog`
- `SaveLocation`
- `SaveRoute`
- `SaveVehicle`
- `SaveSeatLayout`
- `UpdateTrip`
- `SetCatalogResourceActive`

`SetTripActive` is an idempotent internal command and requires `ADMIN` actor
metadata at Catalog Service, not only at a future Gateway resolver. A real
activation change advances the Redis trip-search cache generation before the
command succeeds. Repeating the same target state returns `changed = false`
but still advances the generation so a retry can heal an invalidation failure
that followed an already-committed PostgreSQL update. Unknown trips return gRPC
`NOT_FOUND`.

`TransitionTripStatus` is the M5 lifecycle command exposed through GraphQL as
`transitionTripStatus`. It accepts only `DEPARTED` or `COMPLETED`, requires an
`ADMIN` actor at both Gateway and Catalog, and enforces `SCHEDULED -> DEPARTED
-> COMPLETED`. The client supplies an idempotency key but never actor identity.
Catalog records actor, transition time, request ID, trace ID, and target trip in
its audit table. Invalid skipped or backwards transitions map to GraphQL
`INVALID_STATE_TRANSITION`.

`ListTripPreparationOptions` is an ADMIN-only read used by the operations UI.
It returns active routes and active vehicles with their already assigned active
seat-layout version; the browser does not read Catalog tables or services
directly. `CreateTrip` accepts those IDs, UTC departure/arrival instants, an
integer-VND fare, and an idempotency key. Catalog re-authorizes the actor,
validates that the vehicle is assigned to the supplied layout, then writes the
`SCHEDULED` trip, fare, and `TRIP_CREATED` audit atomically. An exact replay
returns the same trip with `created = false`; reuse with another payload maps
to `IDEMPOTENCY_CONFLICT`.

The remaining M5 Catalog CRUD surface is exposed through GraphQL
`adminCatalog`, `saveAdminLocation`, `saveAdminRoute`, `saveAdminVehicle`,
`saveAdminSeatLayout`, `updateAdminTrip` and `setCatalogResourceActive`.
`GetAdminCatalog` returns only Catalog-owned configuration and recent trips;
the browser never reads PostgreSQL directly. Route saves replace the complete
ordered stop set atomically. Vehicle saves require an active layout assigned to
the same vehicle type. Seat layouts are immutable versions: create a new
version, then deactivate the old one instead of rewriting its JSON. Trip/fare
updates are atomic and limited to `DRAFT` or `SCHEDULED` trips. Delete semantics
for referenced records are soft deactivation. Every command is ADMIN-only,
idempotent by actor/key/fingerprint, invalidates trip-search cache, and records
actor/action/target/UTC time/request/trace in `catalog.admin_audit`.

### SeatInventoryService

- `Health`, `GetSeatMap`, `HoldSeats`, `GetHold`, `ReleaseHold`, `ConfirmSeats`,
  `ReleaseBookedSeats`, `SetSeatBlocked`.

`GetSeatMap` accepts `trip_id`, correlation `request_id`, and an optional
`hold_token`. Seat Inventory obtains the immutable layout snapshot from Catalog
through `CatalogQueryService.GetTrip`, then overlays only its own durable
`BOOKED` and `BLOCKED` rows. It never reads Catalog tables. A seat absent from
durable inventory is returned as `AVAILABLE` unless an active Redis lease exists.
Passing `hold_token` marks only matching seats with `held_by_requester = true`;
another checkout's token is never returned.

`ReleaseBookedSeats` is an internal SYSTEM command from Booking Service. It
accepts booking/trip IDs, the exact seat set and an idempotency key. Seat
Inventory verifies that every row is `BOOKED` by that booking, deletes them in
one transaction, records the release request and publishes an ephemeral
`AVAILABLE` notification. Replay returns the original release timestamp.

`SetSeatBlocked` is the M5 ADMIN command behind GraphQL `setSeatBlocked`. It
accepts one trip, 1-10 layout seat IDs, a block/unblock target, reason and
idempotency key. Gateway and Seat Inventory both require ADMIN metadata. The
owning service rejects booked seats, writes all durable `BLOCKED` changes and
the actor/request/trace audit atomically, then publishes a privacy-safe V2
`BLOCKED` or `AVAILABLE` notification. Exact replay is stable; key reuse with a
different fingerprint returns `IDEMPOTENCY_CONFLICT`. Durable `BOOKED` and
`BLOCKED` state still overrides any stale Redis hold.

The response includes layout identity/version, ordered seat definitions,
effective status, and UTC `generated_at`. Unknown or inactive trips return gRPC
`NOT_FOUND`; malformed UUID/hold-token input returns `INVALID_ARGUMENT`; Catalog
or PostgreSQL failure returns `UNAVAILABLE`. `BOOKED` and `BLOCKED` are durable
truth and will override stale Redis holds when hold composition is added.

All seat commands carry `idempotency_key`. `HoldSeats` carries checkout owner,
trip, 1-10 unique seat IDs and requested TTL from 1-300 seconds. One Redis Lua
script checks every seat before writing any key, so a conflict acquires zero
seats. The response carries one opaque hold token, authoritative unit/total VND
price and UTC `expires_at`.

Guest owner identity comes from Gateway `x-checkout-session-id`, not GraphQL
input. The Gateway generates a privacy-safe UUID when absent and the web keeps
it in session storage. `GetHold` requires both token and the same owner;
`ReleaseHold` with a different owner has no effect. A repeated `HoldSeats` with
the same owner/idempotency key and fingerprint returns the original token; reuse
for a different payload returns `IDEMPOTENCY_CONFLICT`. Idempotency records live
longer than the five-minute lease so a late retry cannot silently reacquire seats.

Redis uses versioned keys under `seat-inventory:hold:v1`, per-seat token leases,
one hold payload and a sorted-set expiry index. Companion expiry metadata lives
longer than the lease so the sweeper can release lingering seat keys and emit an
expiry notification after the hold payload disappears.

Acquire, matching-owner release and expiry sweep publish `SeatStatusChangedV1`
with `HELD`/`AVAILABLE`. Durable confirmation publishes `SeatStatusChangedV2`
with `BOOKED`; M5 seat blocking uses the same V2 envelope for `BLOCKED` and
unblocking publishes `AVAILABLE`. Both versions use
`seat-inventory:events:seat-status:v1` in the same Redis
Lua execution as the ephemeral state change. Payloads contain event identity,
UTC event time, producer, trip ID, seat IDs, a monotonic per-trip version and no
hold token, owner or PII.

The Gateway validates that allowlisted payload and exposes it through
`seatStatusChanged(tripId)`. Redis Pub/Sub and GraphQL Subscription are
notifications only: clients refetch `seatMap` after events and reconnects, and
must not derive durable availability from a missed notification.

`ConfirmSeats` is internal and accepts the hold token, same owner, exact trip
and seat IDs, booking ID, idempotency key, and correlation request ID. Before a
new confirmation it requires an active same-owner Redis hold whose trip/seat
set exactly matches the request. Seat Inventory writes every `BOOKED` row and
the confirmation idempotency record in one PostgreSQL transaction. The unique
`(trip_id, seat_id)` key prevents two bookings from owning one seat; any
conflict rolls back the entire multi-seat confirmation.

A replay with the same booking/key/fingerprint succeeds even after Redis state
has been consumed. Reusing the key for another payload returns
`IDEMPOTENCY_CONFLICT`. Durable confirmation commits before Redis cleanup; the
cleanup removes temporary keys and publishes `SeatStatusChangedV1` with
`BOOKED`. If Redis cleanup fails, durable `BOOKED` remains authoritative and the
failure is logged without exposing the hold token.

### BookingService

- `CreateBooking`
- `SimulatePayment`
- `ListMyBookings`
- `GetFulfillmentSnapshot`
- `MarkTicketIssued`
- `GetBookingByGuestCredential`
- `ListCustomerBookings`
- `CancelBooking`
- `CheckInTicket`
- `GetAdminOperations`

`CreateBooking` supports guest and registered checkout. The public GraphQL input
contains the active hold token, contact, one passenger per seat, and an
idempotency key; it never accepts checkout ownership. The Gateway derives a
`GUEST_SESSION` owner from `x-checkout-session-id` when no access token exists,
or a `CUSTOMER` owner from a validated customer access token. Registered calls
carry actor ID, role and token ID; Booking Service requires an exact actor/owner
match before executing the command.

Booking Service validates the same-owner active hold through Seat Inventory
gRPC and obtains the commercial trip snapshot through Catalog gRPC. The
passenger seat IDs must exactly equal the held seat IDs, with no missing,
duplicate, or extra assignment. Price comes from the authoritative hold and is
stored as integer VND; timestamps are stored as UTC while the snapshot keeps
`Asia/Ho_Chi_Minh` for rendering.

The command creates one durable `PENDING_PAYMENT` booking plus passengers and
initial status history. It does not confirm seats or persist durable `BOOKED`
inventory. Idempotency is scoped by checkout owner and key: replaying the same
normalized request returns the original booking, while reusing the key for a
different request returns `IDEMPOTENCY_CONFLICT`. An expired hold returns
`HOLD_EXPIRED`, a hold owned by another session returns `FORBIDDEN`, malformed
or mismatched passengers return `VALIDATION_ERROR`, and dependency failures
return `DEPENDENCY_UNAVAILABLE`.

Passenger document numbers are optional input only. They are never returned by
GraphQL/gRPC or stored raw; the booking response exposes only
`hasDocumentNumber`.

`ListMyBookings` accepts page size, an optional opaque cursor and correlation
data only. Booking Service derives customer ID from authenticated gRPC metadata,
so callers cannot request another customer's history. Results use descending
keyset pagination by creation time and booking ID; Gateway exposes the page as
`BookingConnection.nodes` plus `pageInfo`.

`GetAdminOperations` is the M5 ADMIN-only operational read exposed as GraphQL
`adminOperations(input)`. An optional trip ID filters the read; bounded booking
and audit limits prevent unbounded dashboard queries. Booking Service returns
recent Booking-owned records, booking/passenger counts, integer-VND recognized
revenue, status counts, and Booking-owned payment/cancellation/check-in audit
events. The Gateway never joins Booking tables with Catalog or Seat Inventory
tables. Both Gateway and Booking Service authorize the ADMIN actor, and audit
rows expose actor, action, target, UTC time, request ID and trace ID without
contact PII.

`CancelBooking` accepts booking ID, idempotency key and correlation data only.
Booking Service derives the CUSTOMER from gRPC actor metadata and returns a
neutral `FORBIDDEN` result for another customer's booking. Only `PAID` and
`TICKET_ISSUED` may transition to `CANCELLED`, and only while the current time
is strictly before `departureAt`. The fixed demo policy code is
`BEFORE_DEPARTURE_FULL_RELEASE`; no real refund or settlement is performed.

The matching GraphQL mutation is `cancelBooking(input)` where input contains no
customer, owner, amount or refund field. Same-key replay returns the original
cancellation; another key after cancellation returns `IDEMPOTENCY_CONFLICT`.
The transition, history and `BookingCancelledV1` outbox records commit together.
Booking then calls Seat Inventory `ReleaseBookedSeats`, which deletes only the
exact `BOOKED` rows owned by that booking and records its own idempotent release.

`SimulatePayment` is the M3.2 checkout orchestrator. Public GraphQL input
contains only booking ID, requested demo outcome, and idempotency key; it never
accepts owner or amount. The Gateway derives the guest owner from
`x-checkout-session-id`. Booking Service loads the same-owner booking and sends
its stored integer-VND total to Payment Service.

A simulated failure returns `PaymentResult.status = FAILED`, leaves the booking
`PENDING_PAYMENT`, and does not call `ConfirmSeats`. A simulated success calls
Seat Inventory `ConfirmSeats` using the payment attempt ID as the stable
confirmation key, then transitions the booking from `PENDING_PAYMENT` to `PAID`
and writes status history. A booking cannot become `PAID` before durable seat
confirmation succeeds. Payment and expiry commands are serialized per booking
with a PostgreSQL advisory lock so expiry cannot overtake an in-flight durable
confirmation. Replaying the paid command returns the same payment attempt;
another payment key after `PAID` returns `INVALID_STATE_TRANSITION`.

Expired hold/departure windows transition `PENDING_PAYMENT -> EXPIRED`
idempotently when observed by the payment command and release any remaining
hold best-effort. Owner mismatch returns `FORBIDDEN`; seat conflict returns
`SEAT_UNAVAILABLE`; payment/confirmation key reuse returns
`IDEMPOTENCY_CONFLICT`; dependency failure returns `DEPENDENCY_UNAVAILABLE`.

`GetFulfillmentSnapshot` and `MarkTicketIssued` are internal M3.4 methods and
require the fixed `SYSTEM` actor metadata. The snapshot is available only for
`PAID`, `TICKET_ISSUED`, `CHECKED_IN` or `COMPLETED` bookings and contains the
owner, contact email, immutable trip facts and passenger-seat assignments needed
by the two workers. It is flattened to the generated protobuf shape at the gRPC
boundary; workers never read Booking tables.

`MarkTicketIssued` validates source event ID, UTC issue time and a ticket count
equal to the booking passenger count. Booking Service alone performs the
idempotent `PAID -> TICKET_ISSUED` transition and records actor `SYSTEM`; replay
returns the current issued status without another transition.

In M5 the same command also registers one minimal ticket reference per booking
passenger: ticket ID, passenger ID, ticket code and a SHA-256 hash of the QR
payload. Booking does not copy HTML, PDF or the raw QR payload from Ticket
Worker. The reference set must exactly match the booking passenger set and is
idempotent across worker retries.

`StaffTicketLookup` and `CheckInTicket` require propagated `STAFF` or `ADMIN`
actor ID, role and token ID at Booking Service. Lookup accepts a booking code,
ticket code or simulated QR payload and returns only operational ticket facts;
it does not return contact email, phone, document data, HTML, PDF or raw QR.
Check-in accepts only a ticket code or QR payload, selected trip ID and
idempotency key. Booking verifies that the ticket belongs to the trip and that
the booking is `TICKET_ISSUED` or already `CHECKED_IN`. The first passenger
check-in advances the booking to `CHECKED_IN`; repeated commands are stable.
Unknown tickets use `NOT_FOUND`, a mismatched trip uses `WRONG_TRIP`, and
cancelled, expired or otherwise invalid bookings use
`INVALID_STATE_TRANSITION`. The check-in audit stores actor, ticket, passenger,
booking, UTC time, request ID and trace ID.

`GetAdminOperations` requires ADMIN metadata in Booking Service. It returns a
bounded recent-booking list, counts by booking status, passenger count,
integer-VND paid revenue, and service-owned audit events. An optional trip ID
filters all projections without joining or reading Catalog tables. Audit
entries identify action, target, actor, UTC time, request ID, and trace ID; they
never expose contact or passenger PII.

### PaymentService

- Implemented through M3.2: `Health`, `CreatePaymentAttempt`.
- Planned for later slices: `GetPaymentAttempt`.

`CreatePaymentAttempt` is internal. Booking Service supplies booking ID,
same-owner metadata, authoritative amount VND, requested demo outcome,
idempotency key, and trace/request metadata. The browser cannot call Payment
Service or set the amount. The service stores no contact PII or hold token.

Idempotency is scoped by booking and key with a normalized request fingerprint.
Same-key replay returns the original attempt; another payload returns
`IDEMPOTENCY_CONFLICT`. A partial unique index permits at most one successful
attempt per booking, so concurrent success commands with different keys still
deduplicate to one attempt. Failure attempts carry stable code
`SIMULATED_FAILURE` and do not prevent a later success with a new key.

### TicketService

- `Health`
- `ListBookingTickets`

Ticket Service is an internal M3.4 read provider owned by Ticket Worker.
`ListBookingTickets` requires a booking ID plus a Gateway-derived checkout owner
and returns only tickets stored for that exact owner. Each ticket includes
commercial display fields, issue time, simulated QR payload, HTML content and
base64-encoded PDF bytes. Unknown, malformed or wrong-owner queries return an
empty ticket list rather than exposing whether another guest booking exists.

### AnalyticsQueryService

- `GetRevenueSummary`
- `GetPopularRoutes`
- `GetPublicPopularRoutes`
- `GetTicketSalesByRoute`
- `GetSearchConversion`

M6.1 implements `GetRevenueSummary` as an ADMIN-only query over an
Analytics-owned projection. `BookingPaidV1` contributes integer-VND revenue,
one paid booking and its passenger count as sold tickets to the Vietnam-local
calendar date of `paidAt`. The consumer durably deduplicates by `eventId` before
updating the projection; replaying the same facts therefore leaves totals
unchanged. The response includes projection freshness via `lastProcessedAt`.

M6.2 implements `GetPopularRoutes` and `GetSearchConversion` as ADMIN-only
queries. `SearchPerformedV2` coexists with V1 and adds only privacy-safe route
matches (`routeId`, origin name, destination name) that were present in the
authoritative Catalog search result. Analytics matches those route IDs with
`BookingPaidV1.routeId`; it never reads Catalog or Booking databases. V1 search
facts remain valid for overall search counts but cannot contribute per-route
ranking. Conversion is `paid bookings / accepted searches * 100`, rounded to
two decimal places and capped at 100 for the dashboard; a zero-search window
returns zero. The cap prevents incomplete historical V1 route attribution from
displaying an invalid percentage while V2 data is being accumulated.

M6.3 implements `GetTicketSalesByRoute` and additive `GetPaymentSummary` as
ADMIN-only queries. Booking replay backfills per-route integer-VND revenue and
ticket counts from `BookingPaidV1`; `PaymentAttemptedV1` supplies succeeded and
failed attempt facts without reading Payment tables. Payment summary also
returns Kafka lag for `booking-events`, `search-events`, and `payment-events`.
Lag is calculated from broker high-water offsets minus the committed offsets of
the active Analytics consumer group; if Kafka admin inspection is unavailable,
the summary remains readable with `consumerLag.available = false`.

## RabbitMQ operational events

Use a topic exchange named `bus.domain`. Initial routing keys:

- `booking.paid.v1`
- `booking.cancelled.v1`
- `booking.expired.v1`
- `ticket.issued.v1`
- `notification.requested.v1`
- `notification.sent.v1`
- `passenger.checked-in.v1`

Event envelope:

```json
{
  "eventId": "uuid",
  "eventType": "BookingPaidV1",
  "eventVersion": 1,
  "occurredAt": "ISO-8601 UTC",
  "traceId": "string",
  "requestId": "string",
  "producer": "booking-service",
  "aggregateId": "booking-id",
  "actorCategory": "GUEST|CUSTOMER|STAFF|ADMIN|SYSTEM",
  "checkoutSessionId": "optional UUID",
  "payload": {}
}
```

Implemented operational events through M3.4 are `BookingPaidV1` on
`booking.paid.v1` and `BookingExpiredV1` on `booking.expired.v1`. RabbitMQ
messages use persistent delivery, the event ID as `messageId`, and carry
`eventId`, version, trace/request IDs, producer, aggregate and actor metadata in
headers. The payload never contains contact PII, identity document data,
payment tokens or the Redis hold token.

M4 adds `BookingCancelledV1` on `booking.cancelled.v1` and the same immutable
fact to Kafka `booking-events`. Its privacy-safe payload contains booking/trip/
route IDs, route code, seat IDs, passenger count, integer VND total,
`cancelledAt`, policy code and `CANCELLED`; it contains no contact PII, document
data, token or refund credential.

The producer commits each event to its PostgreSQL outbox with the domain state.
The relay marks it published only after broker confirmation. Consumers must
assume at-least-once delivery and durably deduplicate by `eventId` before a side
effect. Exhausted producer retries retain the full privacy-safe event and
correlation headers in durable outbox dead-letter state with
`last_error_code`.

M3.4 binds `booking.paid.v1` to independent Ticket and Notification queues.
Each consumer has a durable main/retry/DLQ topology, increments a string retry
header, confirms retry or dead-letter publication before ack, and stores a
PostgreSQL inbox row keyed by `eventId`. Duplicate delivery or replay cannot
create another passenger ticket or simulated email log.

## Kafka analytics events

Topics:

- `search-events`
- `booking-events`
- `payment-events`

Initial facts:

- `SearchPerformedV1`
- `SearchPerformedV2`
- `BookingCreatedV1`
- `BookingPaidV1`
- `BookingCancelledV1`
- `PaymentAttemptedV1`

M3.3 publishes `BookingCreatedV1`, `BookingPaidV1` and `BookingExpiredV1` to
`booking-events`, and `PaymentAttemptedV1` to `payment-events`. Booking/payment
facts use booking ID as the Kafka key. Booking and Payment use transactional
outboxes; Kafka acknowledgement precedes `published_at`, so replay and consumer
deduplication still use `eventId`.

Partition by a stable key suited to ordering: search session for search facts,
booking ID for booking and payment facts. Events are immutable and additive.
Search facts always carry a privacy-safe `searchSessionId`; booking and payment
facts carry it when available so conversion can be computed without matching
on PII. Booking and payment facts also carry `checkoutSessionId` for funnel
diagnostics.

`SearchPerformedV1` is emitted once for every accepted search, including Redis
cache hits. Its payload contains normalized city IDs, local travel date,
normalized filters and sort, result/nearest-date counts, and cache status
`HIT`, `MISS`, or `BYPASS`. Invalid requests emit no fact. Catalog publishes
facts in request order through one producer chain and uses `searchSessionId` as
the Kafka message key. Kafka failure is observable but does not fail the
read-only search response; duplicates remain possible and consumers deduplicate
by `eventId`.

## AI stream adapter

The Next.js `POST /api/chat` route is a presentation boundary, not a new
platform data API. M7.1 accepts `{ "message": "..." }` and returns an AI SDK
text stream. The only enabled tool is `searchTrips`, which first resolves the
two location names through `locationSuggestions` and then calls the existing
`searchTrips` GraphQL operation with typed location IDs and a local travel date.

The route rejects malformed or unsupported questions, never accepts arbitrary
tool calls from the browser, and sends `x-request-id` plus a privacy-safe
`x-search-session-id` to the Gateway. Trip IDs, prices, times and seat counts
in the assistant response must be present in the validated Gateway result.
M7.2 enables `getBookingStatus` only when both booking code and email are
present. The tool calls GraphQL `bookingLookup`; Booking Service performs the
normalized-email match and returns only booking status, trip summary, seat IDs,
ticket-issued state and cancellation eligibility. Wrong email and unknown code
produce the same neutral response. Contact and passenger identity fields are
absent. `getPolicy` can read only `bus://policy/cancellation` and
`bus://policy/checkin`, and answers preserve source title, version and effective
date. Admin tools and external model credentials remain disabled.

M7.3 keeps the same HTTP body and tool contracts while adding boundary rules:

- instruction override, admin-tool escalation and cross-user data extraction
  requests receive a streamed refusal without a tool call;
- emails, phone numbers and bearer-token patterns are redacted before text is
  streamed, and prompt-like instructions embedded in tool display data are not
  rendered;
- the route uses a Redis-backed limit of 12 accepted requests per 60 seconds
  per hashed search session or client address;
- exceeded limits return HTTP 429 with `RATE_LIMITED` and `Retry-After`; Redis
  failure returns HTTP 503 with `DEPENDENCY_UNAVAILABLE`.

## MCP tools

### `search_trips`

Input: origin, destination, local travel date, optional filters and sort.
Output: normalized locations, matching trips, remaining seat count, price VND,
and nearest available dates when empty.

M8.1 accepts location display names up to 120 characters, `YYYY-MM-DD`, optional
`HH:mm` departure bounds, integer VND price bounds, operator/vehicle code lists,
minimum seats, and one of `DEPARTURE_EARLIEST`, `PRICE_LOWEST`, or
`DURATION_SHORTEST`. Unknown fields are rejected. Output includes normalized
location ID/code/name/kind, timezone `Asia/Ho_Chi_Minh`, trip UUIDs, UTC
timestamps, integer VND, and non-negative remaining seats.

### `get_trip_detail`

Input: trip ID. Output: route, stops, times, operator, vehicle type, price,
remaining seats, and policy references.

M8.1 requires a UUID and returns only public Catalog fields. Unknown trips map
to the sanitized `NOT_FOUND` tool error; Catalog validation and availability
map to `INVALID_INPUT` and `DEPENDENCY_UNAVAILABLE` without gRPC details.

### `get_booking_status`

Input: booking code and email. Output: minimal booking state, trip summary, ticket
status, and cancellation eligibility. Never return full identity document data.

M8.2 requires both fields in one strict input object. `bookingCode` uses
`BV-YYYY-XXXXXXXXXX`; email is trimmed, lower-cased, validated, and capped at
254 characters. Booking Service authorizes the lookup using the normalized
pair. Success returns booking code/status, trip UUID, origin/destination,
departure UTC timestamp, `Asia/Ho_Chi_Minh`, up to ten seat IDs,
`ticketIssued`, and `cancellationEligible`. It never returns email, phone,
passenger name, document data, payment data, or internal booking ID.

Wrong code/email and unknown booking share the MCP tool error `LOOKUP_DENIED`
with message `Không thể xác minh booking với thông tin đã cung cấp.` Missing or
malformed fields fail strict schema validation before the Booking call.

M8.2 rate limits `get_booking_status` to 5 calls/60 seconds and other public
tool calls to 30 calls/60 seconds per SHA-256 client-address identifier.
Exceeded quotas return HTTP 429, `Retry-After`, and stable code `RATE_LIMITED`;
Redis failure returns HTTP 503 with `DEPENDENCY_UNAVAILABLE`.

### `get_revenue_summary`

Admin scope required. Strict input contains `fromDate` and `toDate` in
`YYYY-MM-DD`. Output contains daily `localDate`, integer `revenueVnd`,
`paidBookingCount`, and `ticketCount`, plus matching totals, optional
`lastProcessedAt`, and timezone `Asia/Ho_Chi_Minh`.

### `get_popular_routes`

Admin scope required for detailed analytics. Strict input contains `fromDate`,
`toDate`, and optional `limit` from 1 to 20 (default 10). Output contains route
ID/code/label, non-negative search and paid-booking counts, conversion rate from
0 to 100, optional projection freshness, and timezone `Asia/Ho_Chi_Minh`.

M8.3 authenticates both tools at the MCP HTTP boundary through Identity gRPC.
Missing or invalid/revoked Bearer credentials return HTTP 401; authenticated
CUSTOMER or STAFF actors return HTTP 403 before Analytics is called. MCP passes
only actor ID, role, and token ID to Analytics gRPC, and Analytics independently
requires ADMIN. Analytics validation maps to `INVALID_INPUT`; unavailable
Identity or Analytics dependencies map to sanitized HTTP/tool
`DEPENDENCY_UNAVAILABLE` responses. Bearer tokens are never logged.

## MCP resources

- `bus://policy/cancellation` returns title, version, effective date, and policy.
- `bus://policy/checkin` returns title, version, effective date, and guidance.
- `bus://routes/popular` returns a privacy-safe cached route summary.
- `bus://system/health` returns public component status without secrets or
  infrastructure addresses.

M8.1 implements the two policy resources as `text/plain` JSON documents with
`title`, `version`, `effectiveDate`, `uri`, and `content`.

M8.4 implements `bus://routes/popular` as an `application/json` document with
fixed title/version/URI, a maximum 30-day Vietnam-local window, timezone,
optional projection freshness, and at most ten routes. Each route contains only
`routeId`, `routeCode`, `routeLabel`, and non-negative `searchCount`; paid
booking count, conversion, revenue, and actor data are forbidden. Analytics
owns the additive `GetPublicPopularRoutes` gRPC read and validates that its
internal date range is valid, no longer than 31 days, and has a limit from 1 to 10. MCP caches the resulting public document for 60 seconds.

M8.4 implements `bus://system/health` as an `application/json` document with
platform version, overall `UP`/`DEGRADED`, UTC check time, and component
name/status pairs. Component status is limited to `UP` or `DOWN`; hostnames,
ports, dependency URLs, stack traces, raw errors, credentials, and PII are not
part of the contract.

## Contract evolution

- GraphQL fields are deprecated before removal; required inputs are not added to
  existing input objects.
- Protobuf field numbers are never reused and removed fields are reserved.
- Event breaking changes create a new version and coexist during migration.
- MCP tools keep stable names; incompatible input/output changes use a new tool
  name or negotiated schema version.

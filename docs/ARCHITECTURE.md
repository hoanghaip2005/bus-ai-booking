# Architecture

## System shape

```text
Browser / External AI Client
             |
           Nginx
       /      |       \
 Next.js   GraphQL   MCP Server
 UI + AI      Gateway     |
 stream          |        |
                 |        |
                 +--- gRPC service network ---+
                      |       |       |        |
                  Catalog   Booking  Seat    Identity
                                      Inventory
                      |       |       |        |
                   service-owned PostgreSQL databases

Redis: cache, seat holds, rate limits, subscription fan-out
RabbitMQ: operational workflows and background jobs
Kafka: immutable analytics events and replay
```

## Repository target

```text
apps/
  web/                    Next.js customer and admin UI
  graphql-gateway/        public application API and subscriptions
  mcp-server/             external AI client boundary
services/
  identity-service/
  catalog-service/
  booking-service/
  seat-inventory-service/
  payment-service/
  analytics-service/
  ticket-worker/
  notification-worker/
packages/
  proto/                  source protobuf contracts and generated clients
  graphql-contracts/      schema documents and generated client types
  event-contracts/        versioned event schemas
  config/                 validated environment configuration
  observability/          logs, traces, metrics, correlation metadata
  test-kit/               builders, fixed clock, fixtures, containers
infra/
  nginx/
  docker/
  migrations/
docs/
  decisions/
```

## Service ownership

| Component           | Owns                                                                           | Does not own               |
| ------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| Identity            | accounts, roles, refresh sessions, saved passengers                            | bookings                   |
| Catalog             | locations, aliases, operators, routes, vehicles, layout versions, trips, fares | live holds, bookings       |
| Seat Inventory      | durable sold/blocked trip seats, Redis hold protocol                           | payment, passengers        |
| Booking             | bookings, passengers, transition history, cancellation decisions               | seat truth, payment ledger |
| Payment             | simulated payment attempts and idempotency keys                                | booking transition         |
| Ticket Worker       | ticket inbox, owner-scoped ticket records, HTML/PDF/QR artifacts               | booking or seat state      |
| Notification Worker | notification inbox and simulated email delivery log                            | ticket generation          |
| Analytics           | projections derived from Kafka                                                 | operational source records |

For local development, one PostgreSQL container may host these logical databases.
No service may query another service's schema.

Catalog records become immutable snapshots or are deactivated once referenced.
Bookings and tickets copy the commercial facts needed for historical display;
they do not depend on mutable catalog joins to render an issued ticket.

Seat layouts are versioned Catalog configuration assigned to vehicles. Milestone
1 exposes the assigned layout as a read-only seat definition; live
`AVAILABLE/HELD/BOOKED/BLOCKED` state remains exclusively owned by Seat
Inventory from Milestone 2.

## Communication decisions

### GraphQL

The GraphQL Gateway is the browser-facing BFF. It performs boundary validation,
request composition, stable error mapping, DataLoader batching where necessary,
and subscription delivery. Business state transitions stay in owning services.

Next.js route landing and trip-detail pages use the same GraphQL boundary from
server components. Route SEO title, description and canonical URL are rendered
server-side from Catalog-owned location and trip data; the web application does
not query Catalog PostgreSQL or call Catalog gRPC directly.

Guest ticket delivery is also composed at the Gateway. `bookingTickets` derives
the checkout owner from `x-checkout-session-id`, calls Ticket Worker over gRPC,
and never accepts an owner identifier from GraphQL input.

### AI stream

The Next.js AI SDK route is a streaming presentation adapter. It does not query
service databases or own business rules. Typed tools call the GraphQL Gateway or
generated internal clients with the same validation and authorization policy.
Dynamic tool output is validated again before it enters model context.

M7.1 uses a deterministic local provider (`ben-viet-local`) so local and CI
demonstrations do not require an external model credential. The provider emits
one typed `searchTrips` call, then streams a response grounded only in its
validated GraphQL result. The route accepts a single plain-text question, does
not accept client-supplied tool calls, and logs only request metadata and
message length. Its bounded in-memory rate limiter is a local/demo boundary;
shared deployments must replace it with the platform Redis rate-limit adapter.

M7.2 adds two constrained tools. `getBookingStatus` calls the public GraphQL
`bookingLookup` query, which forwards over gRPC to Booking Service. Booking
Service alone matches the normalized email with the booking code and returns a
minimal status projection without contact or passenger identity data. Invalid
code/email combinations share one neutral not-found response. `getPolicy`
reads only versioned cancellation and check-in documents from an explicit
resource allowlist and every answer preserves title, version, effective date
and `bus://` resource URI.

M7.3 applies defense in depth before and after tool execution. The route
classifies instruction override, admin-tool escalation and cross-booking data
exfiltration attempts before selecting any tool. Tool-owned display strings are
treated as untrusted and instruction-like content is suppressed; assistant text
is redacted for email, phone and bearer-token patterns before streaming.

AI rate limiting is distributed through Redis rather than process memory. One
Lua execution atomically increments a fixed-window counter and sets its TTL.
Keys use `ai:rate-limit:v1:{sha256(identifier)}` so raw IP/session identifiers
are not stored. Redis failure fails the AI route closed with a sanitized 503;
it does not bypass the limiter or affect non-AI web/GraphQL traffic.

### MCP boundary

The standalone MCP Server is an external AI-client adapter over Streamable
HTTP. It owns no domain data and never reads a service database. M8.1 public
tools resolve location names and read trip data through the generated Catalog
gRPC client with a two-second deadline, request/trace propagation, strict
schemas, and sanitized `INVALID_INPUT`, `NOT_FOUND`, or
`DEPENDENCY_UNAVAILABLE` results.

The process keeps one Catalog client channel and creates a stateless MCP server
for each HTTP request. Readiness calls Catalog health and returns 503 when the
required dependency is unavailable. Policy resources are fixed, versioned
allowlist entries; they contain no prompt instructions, credentials, service
addresses, or operational data. Booking and analytics/admin tools remain out of
the public M8.1 capability set.

M8.2 adds Booking as a required MCP dependency without transferring booking
ownership. `get_booking_status` forwards booking code plus normalized email to
`BookingService.GetGuestBookingLookup`; Booking alone performs the constant
shape lookup and returns the approved privacy-minimal projection. MCP never
logs either credential, and wrong code/email combinations share one
`LOOKUP_DENIED` response.

Tool invocation is rate-limited before MCP execution through one Redis Lua
operation. The key namespace is
`mcp:rate-limit:v1:{public|booking_lookup}:{sha256(clientAddress)}`; raw client
addresses and lookup credentials are never stored. Booking lookup has a
separate 5/minute bucket while other public tools use 30/minute. Limits return
HTTP 429 with `Retry-After`; Redis failure fails closed with HTTP 503. MCP
initialize, tool discovery, and resource reads do not consume tool quotas.

M8.3 adds Identity and Analytics as required MCP dependencies. Revenue and
popular-route calls require a Bearer token that MCP validates through generated
Identity gRPC before tool execution. CUSTOMER and STAFF actors are denied at
the adapter; ADMIN actor ID, role, and token ID are propagated to Analytics,
which independently authorizes both reads. Tool logs contain the tool name,
outcome, actor ID and role, but never the bearer token. Identity/Analytics
failure returns a sanitized 503, missing or invalid credentials return 401,
and a valid non-admin actor returns 403.

M8.4 adds two public resources without widening admin analytics output.
`bus://routes/popular` calls the additive public Analytics gRPC read, which
accepts at most a 31-day range and returns only route ID/code/label plus search
count. MCP fixes the window to the latest 30 Vietnam-local dates and caches the
document in Redis for 60 seconds under `mcp:resource:v1:popular-routes`.
`bus://system/health` checks Catalog, Booking, Identity, Analytics, and Redis in
parallel and returns only component names with `UP`/`DOWN`; it never serializes
addresses, ports, credentials, traces, or exception details. Resource reads
emit outcome counters but do not log resource bodies.

Nginx bounds MCP requests to 256 KiB, ten requests/second per client with a
burst of twenty, and twenty concurrent connections. Upstream connect/send
timeouts are bounded while the read timeout remains compatible with Streamable
HTTP. The release runbook also defines the isolated PostgreSQL restore drill
and bounded MCP load gate.

M8.5 packages a vendor-neutral release dashboard contract under
`docs/observability/release-dashboard.json`. It references only metrics already
emitted by the platform (MCP outcomes/rate limits, outbox/consumer delivery,
ticket issuance, simulated notification, and expiry reconciliation); it does
not introduce a metrics backend or cross-service database reads. CI validates
panel identity, required alert predicates, and unique IDs. The release gate is
the documented clean-start command sequence plus the complete acceptance suite;
rollback has no schema downgrade because this slice adds no migration.

### gRPC

All synchronous service-to-service and Gateway-to-service calls use protobuf
contracts. Deadlines are required. Safe reads may retry with bounded backoff.
Commands retry only with an idempotency key.

Ticket and Notification workers obtain the paid booking fulfillment snapshot
from Booking Service using fixed `SYSTEM` actor metadata. Ticket Worker reports
the completed ticket count back through `MarkTicketIssued`; Booking Service
alone owns and enforces `PAID -> TICKET_ISSUED`. Ticket Worker exposes only an
owner-scoped `ListBookingTickets` read to the Gateway.

### RabbitMQ

Use a topic exchange for operational events. Each side effect has a separate
durable queue. For example, `booking.paid.v1` routes to both `ticket.issue` and
`notification.booking-paid`; consumers never share one work queue when both
must process the event.

Each worker owns a durable main queue, fixed-delay retry queue and dead-letter
queue. A failed delivery is republished with an incremented retry header and
confirmed by RabbitMQ before the original message is acknowledged.

### Kafka

Kafka stores replayable analytics facts. Events carry `eventId`, `eventVersion`,
`occurredAt`, `traceId`, actor category, and a privacy-reviewed payload. Consumer
projections deduplicate by `eventId`.

M6.1 introduces Analytics Service as the sole owner of `analytics.*` tables.
Its stable consumer group replays `booking-events` from the beginning, inserts
each `eventId` into a durable inbox in the same transaction as the projection,
and derives daily paid revenue using the `Asia/Ho_Chi_Minh` calendar date of
`BookingPaidV1.paidAt`. Kafka offsets are committed only after that transaction
returns. Duplicate or replayed facts therefore cannot inflate revenue.

M6.2 advances the consumer group to a new replay generation and subscribes to
both `booking-events` and `search-events`. Projection-specific tables keep paid
route and search-route facts keyed by `eventId`, so replay can backfill a newly
added projection without changing the already-deduplicated daily revenue.
`SearchPerformedV2` carries the route IDs and display labels that were actually
returned by Catalog, allowing Analytics to correlate with Booking facts without
a synchronous Catalog dependency or a cross-service database read.

M6.3 advances the replay generation again to consume `payment-events` and
backfill route revenue into projection-specific facts. Analytics exposes actual
consumer lag using Kafka broker high-water and committed group offsets rather
than inferring lag from event timestamps. Kafka admin failure degrades only the
lag field; durable PostgreSQL reports remain available.

### Redis

Redis keys use namespaced versioned formats. Seat acquisition uses a Lua script
to validate every requested seat before writing any key. A sorted-set expiry
index and sweeper emits realtime expiration notifications; correctness does not
depend on Redis keyspace notifications.

Catalog search uses cache-aside keys under `catalog:trip-search:v1`. Keys hash a
canonical request after station-to-city resolution and use a short TTL. Trip
changes advance a generation key; a search miss writes only to the generation
observed before its PostgreSQL query, so an invalidation racing that query
cannot repopulate the active generation with stale results. Redis failure
bypasses the cache and PostgreSQL remains authoritative.

## Seat hold protocol

1. Gateway sends checkout session, trip, seat IDs, and idempotency key to Booking.
2. Booking requests `HoldSeats` from Seat Inventory.
3. Seat Inventory checks durable booked/blocked rows.
4. One Redis Lua script checks active holds and acquires all requested seats.
5. Response contains opaque hold token, authoritative price, and expiry time.
6. Seat events are published to Redis fan-out for GraphQL subscriptions.
7. Payment is accepted only while the hold is valid.
8. Booking confirms seats before committing `PAID`.
9. Seat Inventory inserts durable sold rows with a unique trip-seat constraint,
   then removes Redis keys. If cleanup fails, durable `BOOKED` still wins.
10. Booking serializes payment and expiry commands per booking with a PostgreSQL
    advisory lock so an in-flight durable confirmation cannot race an `EXPIRED`
    transition.

## Consistency and failure handling

- Booking and Payment commit domain state and outgoing messages in the same
  PostgreSQL transaction. Booking owns its outbox and expiry reconciler;
  Payment owns its outbox.
- Outbox relays claim work with `FOR UPDATE SKIP LOCKED`, recover abandoned
  claims after a lease timeout, and mark a row published only after RabbitMQ
  confirms or Kafka acknowledges the message.
- Delivery is at-least-once. A process failure after broker acknowledgement but
  before `published_at` can publish a duplicate, so consumers deduplicate by
  `eventId` in their own PostgreSQL inbox before applying a side effect.
- Producer retry uses bounded exponential backoff with deterministic jitter.
  Poison producer events remain in the owning outbox's durable dead-letter
  state. Ticket and Notification consumers separately use fixed-delay RabbitMQ
  retry queues and owning DLQs with stable error codes and retained
  trace/request headers.
- Consumers commit an inbox/deduplication record and side effect before acking.
  Ticket documents and notification logs therefore remain logically exactly
  once under duplicate, retry and replay delivery.
- Event handlers are safe under duplicate, delayed, and out-of-order delivery.
- Distributed transactions are forbidden.
- A workflow that cannot complete moves to a visible retry or dead-letter state.
- Analytics is eventually consistent. Booking and seat confirmation are
  synchronous on the checkout critical path.

## Security boundaries

- Nginx terminates external traffic and applies body, rate, and timeout limits.
- Identity Service owns password credentials, roles and refresh sessions in its
  own PostgreSQL schema. Passwords use fixed-parameter scrypt hashes; refresh
  tokens are opaque and only their SHA-256 digest is persisted.
- The browser performs login, refresh and logout through GraphQL. Gateway calls
  Identity over gRPC, validates short-lived HS256 access tokens through the
  owning service and propagates `x-actor-id`, `x-actor-role` and
  `x-actor-token-id` over internal gRPC metadata.
- Refresh tokens rotate on every use. Reuse of an already-rotated token revokes
  the remaining active sessions in that token family; logout revokes the
  presented active refresh session.
- Access JWTs include the issuing refresh-session ID as an Identity-private
  `sid` claim. `ValidateAccessToken` rechecks that session ownership, expiry,
  and revocation state, so logout or rotation invalidates the replaced access
  token immediately. The session ID is not propagated to other services.
- Identity Service also owns saved passenger profiles for active CUSTOMER
  accounts. Profile commands derive the owner from authenticated actor metadata,
  never from public input, and scope every read/write by that owner. Profiles
  contain only a label, passenger name and optional normalized phone; identity
  document numbers remain booking-only data and are not persisted in profiles.
- Gateway authenticates external requests and applies coarse role checks;
  owning services authorize privileged commands again from actor metadata.
  Catalog's `SetTripActive` requires an ADMIN role plus valid actor and token
  UUIDs, independently of the Gateway decision.
- Registered checkout derives `CUSTOMER` ownership exclusively from the
  validated access token. Gateway propagates actor ID, role and token ID to
  Seat Inventory, Booking and Ticket; those owning services reject mismatched
  customer-owner commands. Guest checkout continues to derive an unrelated
  `GUEST_SESSION` UUID from the browser header.
- Booking history is owned and queried by Booking Service. `ListMyBookings`
  derives the customer ID from authenticated gRPC metadata and uses keyset
  pagination over `(created_at, id)`; Gateway never supplies an arbitrary
  customer ID and never joins Identity data into Booking reads.
- Checkout may copy a saved profile returned through Gateway -> Identity gRPC
  into its form, but `CreateBooking` still receives and persists an independent
  passenger snapshot. Booking Service never reads the Identity schema or calls
  Identity to resolve a profile during booking creation.
- Registered cancellation is owned by Booking Service. Gateway and Booking both
  require the authenticated CUSTOMER, while the public command contains only a
  booking ID and idempotency key. The minimal policy permits `PAID` or
  `TICKET_ISSUED` cancellation strictly before the stored UTC departure time.
- Booking commits `CANCELLED`, status history and `BookingCancelledV1` to its
  outbox atomically, then calls Seat Inventory over gRPC to remove the exact
  durable `BOOKED` rows. Seat release has its own idempotency record. A Booking
  reconciler retries cancelled bookings whose release acknowledgement was not
  persisted, so a transient failure converges without a distributed transaction.
- Ticket and Notification workers treat a delayed `BookingPaidV1` as processed
  without issuing documents or email when the authoritative Booking snapshot
  is already `CANCELLED`.
- Guest lookup uses booking code plus normalized email and strict rate limits.
- Guest ticket reads require the booking ID plus the same derived checkout
  session owner; Ticket Worker enforces ownership in its own query.
- Booking fulfillment gRPC methods require the fixed internal `SYSTEM` actor;
  workers cannot impersonate a customer or bypass Booking state transitions.
- MCP booking lookup follows the same rule. Revenue tools require admin scope.
- The M5 operational dashboard composes only typed service responses. Booking
  Service calculates booking count, passenger count, recognized integer-VND
  revenue and status counts from its own schema; Gateway does not perform a
  cross-service database join. Catalog owns trip creation/lifecycle audit,
  Seat Inventory owns block audit, and Booking owns payment/cancellation/check-in
  audit.
- AI tool input is untrusted input and passes the same validators as GraphQL.
- PII is encrypted where appropriate, redacted in logs, and omitted from Kafka
  unless an aggregate requires a pseudonymous identifier.

## Observability baseline

Every request or event path includes:

- structured logs with service, operation, result, trace ID, and duration;
- OpenTelemetry traces over HTTP, GraphQL, gRPC, RabbitMQ, and Kafka;
- RED metrics for APIs and queue lag/retry/dead-letter metrics for workers;
- business metrics for search, hold conflict, payment, issue, and check-in.

The executable foundation initializes OpenTelemetry before NestJS, GraphQL,
HTTP and gRPC modules are loaded. Nginx supplies an inbound request ID, the
Gateway preserves it in response headers and gRPC metadata, and Catalog returns
the active trace ID in the foundation health contract. Console export is opt-in;
the default local exporter is in-memory to avoid noisy development logs.

Booking and Payment relays emit structured publish/retry/dead-letter logs with
event ID, destination, attempt, duration and correlation metadata. OpenTelemetry
counters cover published, retried, dead-lettered and poll-failed outbox work;
Booking also counts reconciled and failed background expiry operations.

Ticket and Notification consumers emit processed/retry/dead-letter counters and
structured logs without passenger names, recipient email, rendered ticket data
or QR payloads.

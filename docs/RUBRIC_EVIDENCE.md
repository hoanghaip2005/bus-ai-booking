# Rubric Evidence

Last reviewed: 2026-07-18

This document maps the requested rubric to implementation and executable
evidence. The rows containing `KHONG` are interpreted as failure conditions:
the project must demonstrate that the named technology is used, not merely
listed in a dependency file. The first two supplied screenshots are identical,
so they contribute one set of criteria.

## Mandatory architecture

| Criterion                                                     | Verdict | Evidence                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Microservices, GraphQL API Gateway, and gRPC between services | PASS    | Service boundaries and browser boundary are documented in `docs/ARCHITECTURE.md`. The Gateway resolver calls generated protobuf clients; source services implement `CatalogQueryService`, `SeatInventoryService`, and `BookingService` in `packages/contracts-proto/proto/`. `pnpm test:contract`, integration tests, and `pnpm test:smoke` verify the path through Nginx.            |
| Redis cache                                                   | PASS    | `services/catalog-service/src/trip-search-cache.ts` implements cache-aside search results with TTL and generation invalidation. Redis also owns seat holds, rate limits, and subscription fan-out. `services/catalog-service/src/search-cache-analytics.integration.spec.ts` verifies hit/miss, expiry, invalidation, and analytics behavior against real Redis.                      |
| RabbitMQ/Kafka                                                | PASS    | RabbitMQ carries `BookingPaidV1` operational workflow events to separate Ticket and Notification queues. Kafka carries immutable search, booking, and payment analytics facts. `tests/integration/fulfillment-workers.integration.spec.ts`, `tests/integration/outbox-workers.integration.spec.ts`, and Analytics integration tests cover delivery, retry, deduplication, and replay. |
| Nginx and load balancing                                      | PASS    | `infra/nginx/nginx.conf` defines `graphql_gateway_pool` with two upstream Gateway workers, passive failure handling, and round-robin routing. The GraphQL Gateway entrypoint forks Node cluster workers on ports 4000 and 4010 by default; `scripts/verify-load-balancer.mjs` sends GraphQL requests through Nginx and asserts both worker IDs are observed.                          |
| Next.js frontend                                              | PASS    | `apps/web/package.json` uses Next.js 16. Search, SSR route pages, checkout, account, staff, admin, and AI routes are implemented under `apps/web/app`. Browser E2E runs through the Nginx entrypoint.                                                                                                                                                                                 |

The local demo uses two Gateway worker processes under one Node cluster primary.
Nginx distribution and worker restart are real and verified through both ports.
Production high availability still requires separate containers or hosts so a
single machine failure cannot remove the whole pool; the Nginx routes do not
need to change.

## Screenshot criteria

| Criterion from supplied images                           | Verdict | Evidence                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search trips and display results                         | PASS    | `apps/web/app/components/trip-search-form.tsx`, `apps/web/app/trips/trip-results.tsx`, GraphQL `searchTrips`, Catalog gRPC `SearchTrips`. Includes validation, loading, error, empty, and result states. Covered by `tests/e2e/location-autocomplete.spec.ts` and trip search E2E cases.                               |
| Autocomplete, filters, and sorting                       | PASS    | `apps/web/app/components/location-autocomplete.tsx` and `apps/web/app/trips/trip-filters.tsx` provide keyboard autocomplete, URL-persisted filters, and departure/price/duration sorting. Catalog integration tests cover all filter and sort combinations.                                                            |
| Trip detail, SEO, and nearest-date suggestions           | PASS    | SSR pages are implemented in `apps/web/app/trips/[id]/page.tsx` and `apps/web/app/routes/[routeSlug]/page.tsx`. Catalog returns `nearestTravelDates`; route metadata and canonical URLs are server-rendered. SEO and nearest-date E2E cases are in `tests/e2e/location-autocomplete.spec.ts`.                          |
| Search cache records a search event                      | PASS    | Catalog emits versioned `SearchPerformedV1/V2` facts after valid searches, including cache status, and Analytics consumes the Kafka topic. Redis hit/miss and event assertions are in `services/catalog-service/src/search-cache-analytics.integration.spec.ts`.                                                       |
| Seat map and seat states                                 | PASS    | Seat layout comes from Catalog and authoritative `AVAILABLE`, `HELD`, `BOOKED`, and `BLOCKED` state comes from Seat Inventory. GraphQL exposes `seatMap` and the Next.js selector renders state and ownership.                                                                                                         |
| Safe seat hold with gRPC and Redis TTL                   | PASS    | `services/seat-inventory-service/src/seat-inventory.service.ts` calls the Redis Lua-backed hold store; Gateway calls generated `HoldSeats` gRPC. `services/seat-inventory-service/src/seat-hold.integration.spec.ts` verifies TTL, ownership, idempotency, and all-or-nothing acquisition.                             |
| Countdown, automatic release, and near-real-time updates | PASS    | `apps/web/app/trips/[id]/seat-selector.tsx` counts down from server `expiresAt`; `seat-hold.store.ts` sweeps expired leases and publishes Redis events; Gateway exposes `seatStatusChanged` and the client refetches authoritative state. `tests/e2e/location-autocomplete.spec.ts` covers countdown/release behavior. |
| Double-booking race test                                 | PASS    | Redis acquisition is atomic and durable seat confirmation has a unique trip-seat constraint. `pnpm test:seat-race` asserts exactly one winner for 100 concurrent owners and rejects the remaining conflicts.                                                                                                           |
| Passenger information and passenger-seat mapping         | PASS    | `apps/web/app/trips/[id]/guest-booking-form.tsx` collects one passenger per selected seat; Booking validates the full mapping before creating `PENDING_PAYMENT`. Integration tests cover multi-seat passenger mapping.                                                                                                 |
| Guest and registered checkout                            | PASS    | Checkout ownership is derived from the guest session header or authenticated CUSTOMER actor; the browser does not submit an arbitrary owner ID. `tests/e2e/auth.spec.ts` and booking/payment integration tests cover both paths.                                                                                       |
| Booking state machine, expiry, and cancellation          | PASS    | Booking domain transitions are enforced in `services/booking-service/src/booking.service.ts`; invalid transitions, payment expiry, cancellation cutoff, idempotency, and seat release are integration-tested.                                                                                                          |
| Simulated payment and seat confirmation                  | PASS    | GraphQL `simulatePayment` calls Booking and Payment contracts; success confirms seats before `PAID`, failure remains retryable, and duplicate success is idempotent. Covered by `tests/integration/booking-payment.integration.spec.ts` and the payment E2E flow.                                                      |
| RabbitMQ, ticket creation, and asynchronous notification | PASS    | `BookingPaidV1` is published to RabbitMQ; `services/ticket-worker` and `services/notification-worker` consume separate queues with retry/DLQ and inbox deduplication. `tests/integration/fulfillment-workers.integration.spec.ts` verifies both side effects.                                                          |
| Electronic ticket and booking lookup                     | PASS    | Ticket Worker owns deterministic HTML/PDF/QR artifacts; GraphQL exposes owner-checked ticket delivery and `bookingLookup` requires booking code plus normalized email. Ticket, smoke, and AI privacy tests verify the projection and denial behavior.                                                                  |
| Login and authorization                                  | PASS    | Identity Service owns CUSTOMER, STAFF, and ADMIN roles. Gateway and the owning service both authorize privileged commands; `/login` redirects each role to its canonical workspace. `tests/e2e/auth.spec.ts` and Identity integration tests cover login, denial, refresh, and logout.                                  |

## Verification commands

Run the following from a clean environment when presenting the rubric:

```text
pnpm env:up
pnpm env:wait
pnpm db:migrate
pnpm db:seed
pnpm dev
pnpm test:load-balancer
pnpm test:smoke
pnpm test:integration
pnpm test:seat-race
pnpm test:workers
pnpm test:e2e
pnpm test:mcp
pnpm test:ai-eval
```

`pnpm dev` now starts two stateless GraphQL Gateway worker processes. Nginx remains the
only browser boundary; services are not exposed directly to the browser.

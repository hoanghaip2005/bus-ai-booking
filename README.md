# Intercity Bus Booking Platform

Executable foundation for an AI-assisted intercity bus booking platform. The
repository is a TypeScript monorepo with a Next.js web app, NestJS GraphQL
Gateway, gRPC Catalog Service, MCP Server, OpenTelemetry and local
infrastructure.

## Quick start

Requirements: Node.js 22+, pnpm 11+ and Docker Desktop.

```bash
pnpm install
pnpm contracts:generate
pnpm env:up
pnpm env:wait
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Local entrypoints:

| Endpoint                                      | Purpose                                            |
| --------------------------------------------- | -------------------------------------------------- |
| `http://localhost:8080`                       | Nginx edge and Next.js web                         |
| `http://localhost:8080/graphql`               | GraphQL Gateway through Nginx                      |
| `http://localhost:8080/mcp`                   | Stateless MCP Streamable HTTP endpoint             |
| `http://localhost:8080/health`                | Nginx health                                       |
| `http://localhost:8080/seat-inventory-health` | Seat Inventory readiness through Nginx             |
| `http://localhost:15672`                      | RabbitMQ management (`bus` / `bus_local_password`) |

Stop the application with `Ctrl+C`, then stop infrastructure with
`pnpm env:down`. Use `pnpm verify` for the complete local quality gate.
`pnpm test:smoke` verifies HTTP, GraphQL, gRPC, MCP and GraphQL Subscription
while the stack is running.

Example location autocomplete query:

```graphql
query LocationSuggestions($query: String!) {
  locationSuggestions(query: $query) {
    id
    code
    name
    kind
    parentLocationId
  }
}
```

Use `{ "query": "Sai Gon" }` to resolve the seeded `TP.HCM` alias.

Example trip search query:

```graphql
query SearchTrips($input: SearchTripsInput!) {
  searchTrips(input: $input) {
    timezone
    trips {
      operatorName
      departureAt
      priceVnd
      remainingSeats
    }
  }
}
```

The demo route `TP.HCM -> Đà Lạt` has three trips on `2030-06-20`.
The result page supports departure period, maximum price, operator, vehicle
type, minimum-seat filters and all three required sort modes. Searching
`2030-06-19` demonstrates nearby-date suggestions.

## Documentation

- `RUN_AND_TEST.md`: hướng dẫn chi tiết chạy, demo, test và troubleshooting.
- `docs/ARCHITECTURE.md`: service ownership and communication boundaries.
- `docs/CONTRACTS.md`: GraphQL, gRPC, event, AI and MCP contracts.
- `docs/RELEASE_RUNBOOK.md`: clean demo, verification and rollback commands.
- `docs/decisions/`: architecture decision records.

## Stack

- pnpm workspace and Turborepo
- Next.js 16, React 19, TypeScript 5.9 and Tailwind CSS 4
- NestJS GraphQL Gateway and NestJS microservices
- Protocol Buffers and gRPC for internal synchronous calls
- PostgreSQL with one logical database per owning service
- Redis for seat holds, cache, rate limits, and realtime fan-out
- RabbitMQ for operational workflows
- Kafka for analytics event streams
- Standalone Model Context Protocol server
- Nginx as the local and deployment edge proxy

The complete demo scope is implemented: public and registered checkout, atomic
seat holds, simulated payment, ticket workers, administration, check-in,
analytics, AI SDK chat and an external MCP server. Run `pnpm verify` for static,
contract, unit and build gates, then use `pnpm demo:verify` while the stack is
running for the end-to-end release journey.

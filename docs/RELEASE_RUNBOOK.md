# Demo and release runbook

## Clean demo flow

From the workspace root:

```text
pnpm install
pnpm env:up
pnpm env:wait
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Keep `pnpm dev` running. In a second terminal run:

```text
pnpm demo:verify
```

The command waits for every Nginx-exposed application readiness route, runs the
full booking/payment/ticket/analytics/AI/MCP smoke journey, then runs a bounded
MCP resource-list load check.

## MCP verification

- Public resources: `bus://policy/cancellation`, `bus://policy/checkin`,
  `bus://routes/popular`, and `bus://system/health`.
- The popular-route resource exposes search ranking only. Paid counts, revenue,
  conversion, credentials, and infrastructure addresses are excluded.
- The system-health resource exposes only component names and `UP`/`DOWN`.
- Nginx limits MCP bodies to 256 KiB, applies a per-IP request burst limit and
  concurrent-connection cap, and bounds upstream connection/send timeouts.

Validate Nginx configuration after editing it:

```text
docker compose -f infra/docker-compose.yml exec -T nginx nginx -t
```

## PostgreSQL backup/restore drill

Run against the local demo environment:

```text
pnpm test:backup-restore
```

The drill creates a custom-format dump inside the PostgreSQL container, restores
it into the fixed temporary database `bus_platform_restore_drill`, verifies
Booking and Analytics tables, then removes both the temporary database and dump.
It never overwrites the active `bus_platform` database.

## Operational checks

```text
pnpm verify
pnpm test:mcp
pnpm test:ai-eval
pnpm test:seat-race
pnpm test:workers
```

The release dashboard contract is stored at
`docs/observability/release-dashboard.json` and validated with:

```text
pnpm test:release-dashboard
```

## Go/no-go checklist

- GO only when `pnpm verify`, `pnpm test:contract`, `pnpm test:integration`,
  `pnpm test:e2e`, `pnpm test:ai-eval`, `pnpm test:seat-race`,
  `pnpm test:workers`, `pnpm test:mcp`, `pnpm test:smoke`,
  `pnpm test:backup-restore`, `pnpm test:mcp-load`, and
  `pnpm test:release-dashboard` pass from a clean-start environment.
- HOLD when any dependency readiness route is degraded, RabbitMQ has queued
  messages, Redis temporary namespaces are non-empty, or the MCP resource/load
  checks fail.
- ROLLBACK by stopping the application stack and restoring the previous app
  artifact; no M8.5 database migration is introduced, so rollback has no schema
  downgrade step.

Before handoff, stop application processes while leaving the five infrastructure
containers healthy. RabbitMQ queues should contain zero messages and Redis keys
under `seat-inventory:hold:v1:*`, `ai:rate-limit:v1:*`,
`mcp:rate-limit:v1:*`, and `mcp:resource:v1:*` should be empty.

import { readFileSync } from 'node:fs';

const dashboard = JSON.parse(readFileSync('docs/observability/release-dashboard.json', 'utf8'));
if (dashboard.schemaVersion !== 1 || dashboard.dashboardId !== 'bus-platform-release') {
  throw new Error('Release dashboard identity is invalid.');
}
if (!Number.isInteger(dashboard.refreshSeconds) || dashboard.refreshSeconds < 10) {
  throw new Error('Release dashboard refresh interval is invalid.');
}
if (!Array.isArray(dashboard.panels) || dashboard.panels.length < 5) {
  throw new Error('Release dashboard must contain the critical-path panels.');
}
const ids = dashboard.panels.map((panel) => panel.id);
if (new Set(ids).size !== ids.length)
  throw new Error('Release dashboard panel IDs must be unique.');
for (const panel of dashboard.panels) {
  if (!panel.title || !panel.metric || !panel.alert?.condition) {
    throw new Error(`Release dashboard panel ${panel.id ?? 'unknown'} is incomplete.`);
  }
}
const metricSources = [
  'apps/mcp-server/src/main.ts',
  'apps/mcp-server/src/mcp-server.ts',
  'services/booking-service/src/booking-outbox.relay.ts',
  'services/booking-service/src/booking-expiry.reconciler.ts',
  'services/payment-service/src/payment-outbox.relay.ts',
  'packages/worker-runtime/src/index.ts',
  'services/ticket-worker/src/ticket.service.ts',
  'services/notification-worker/src/notification.service.ts',
]
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
for (const panel of dashboard.panels) {
  for (const metric of [panel.metric, ...(panel.relatedMetrics ?? [])]) {
    if (!metricSources.includes(`'${metric}'`) && !metricSources.includes(`"${metric}"`)) {
      throw new Error(`Release dashboard references metric that is not emitted: ${metric}.`);
    }
  }
}
console.log(`Release dashboard validated: ${dashboard.panels.length} panels.`);

import { startTelemetry } from '@bus/observability';

startTelemetry({
  serviceName: 'mcp-server',
  serviceVersion: '0.5.0',
});

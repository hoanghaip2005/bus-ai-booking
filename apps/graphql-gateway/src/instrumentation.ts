import { startTelemetry } from '@bus/observability';

startTelemetry({
  serviceName: 'graphql-gateway',
  serviceVersion: '0.1.0',
});

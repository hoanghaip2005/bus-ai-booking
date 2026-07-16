import { startTelemetry } from '@bus/observability';

startTelemetry({
  serviceName: 'catalog-service',
  serviceVersion: '0.1.0',
});

import { startTelemetry } from '@bus/observability';

startTelemetry({ serviceName: 'seat-inventory-service', serviceVersion: '0.1.0' });

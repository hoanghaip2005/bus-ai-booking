import { startTelemetry } from '@bus/observability';

startTelemetry({ serviceName: 'payment-service', serviceVersion: '0.1.0' });

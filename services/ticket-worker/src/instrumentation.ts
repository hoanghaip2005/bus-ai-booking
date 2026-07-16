import { startTelemetry } from '@bus/observability';

startTelemetry({ serviceName: 'ticket-worker', serviceVersion: '0.1.0' });

import { startTelemetry } from '@bus/observability';

startTelemetry({ serviceName: 'notification-worker', serviceVersion: '0.1.0' });

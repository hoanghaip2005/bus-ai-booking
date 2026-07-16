import { startTelemetry } from '@bus/observability';

startTelemetry({ serviceName: 'booking-service', serviceVersion: '0.1.0' });

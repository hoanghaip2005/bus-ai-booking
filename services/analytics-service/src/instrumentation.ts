import { startTelemetry } from '@bus/observability';

startTelemetry({ serviceName: 'analytics-service', serviceVersion: '0.1.0' });

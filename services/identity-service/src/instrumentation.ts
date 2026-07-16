import { startTelemetry } from '@bus/observability';

startTelemetry({ serviceName: 'identity-service', serviceVersion: '0.1.0' });

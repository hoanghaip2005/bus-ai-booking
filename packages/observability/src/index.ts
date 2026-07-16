import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

import {
  context,
  metrics,
  propagation,
  trace,
  type Attributes,
  type Counter,
} from '@opentelemetry/api';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ConsoleSpanExporter,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

interface RequestContext {
  requestId: string;
}

interface LogInput {
  service: string;
  level?: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  message: string;
  requestId?: string;
  fields?: Record<string, unknown>;
}

interface TelemetryOptions {
  serviceName: string;
  serviceVersion: string;
}

const requestStorage = new AsyncLocalStorage<RequestContext>();
let telemetryStarted = false;
let sdk: NodeSDK | undefined;
const counters = new Map<string, Counter>();

export function startTelemetry(options: TelemetryOptions): void {
  if (telemetryStarted || process.env.OTEL_SDK_DISABLED === 'true') {
    return;
  }

  telemetryStarted = true;
  const inMemoryExporter = new InMemorySpanExporter();
  const spanExporter =
    process.env.OTEL_TRACES_EXPORTER === 'console' ? new ConsoleSpanExporter() : inMemoryExporter;
  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: options.serviceName,
      [ATTR_SERVICE_VERSION]: options.serviceVersion,
    }),
    spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();

  if (spanExporter === inMemoryExporter) {
    const cleanup = setInterval(() => inMemoryExporter.reset(), 60_000);
    cleanup.unref();
  }

  const shutdown = () => {
    void sdk?.shutdown();
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

export function createRequestId(value?: string | string[]): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (candidate && /^[A-Za-z0-9._-]{1,128}$/.test(candidate)) {
    return candidate;
  }
  return randomUUID();
}

export function withRequestContext<T>(requestId: string, callback: () => T): T {
  return requestStorage.run({ requestId }, callback);
}

export function currentRequestId(): string | undefined {
  return requestStorage.getStore()?.requestId;
}

export function currentTraceContext(): { traceId?: string; spanId?: string } {
  const spanContext = trace.getSpan(context.active())?.spanContext();
  return {
    traceId: spanContext?.traceId,
    spanId: spanContext?.spanId,
  };
}

export function activePropagationHeaders(): Record<string, string> {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier;
}

export function logEvent(input: LogInput): void {
  const traceContext = currentTraceContext();
  const record = {
    timestamp: new Date().toISOString(),
    level: input.level ?? 'info',
    service: input.service,
    event: input.event,
    message: input.message,
    requestId: input.requestId ?? currentRequestId(),
    ...traceContext,
    ...input.fields,
  };

  const output = JSON.stringify(record);
  if (record.level === 'error') {
    console.error(output);
  } else if (record.level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export function incrementCounter(name: string, attributes: Attributes = {}, value = 1): void {
  let counter = counters.get(name);
  if (!counter) {
    counter = metrics.getMeter('@bus/observability').createCounter(name);
    counters.set(name, counter);
  }
  counter.add(value, attributes);
}

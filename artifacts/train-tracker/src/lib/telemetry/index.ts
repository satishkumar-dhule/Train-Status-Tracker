/**
 * Frontend (RUM) OpenTelemetry bootstrap.
 *
 * Importing this module has no side effects; nothing is registered until
 * {@link initTelemetry} is called (from `main.tsx`). When telemetry is not
 * enabled the init is a cheap no-op and `@opentelemetry/api` stays on its
 * no-op providers, so the SPA is unaffected in tests and dev without a
 * collector.
 */

import { context, metrics, SpanStatusCode, trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  WebTracerProvider,
} from '@opentelemetry/sdk-trace-web';
import { getTelemetryConfig, isTelemetryEnabled, type TelemetryConfig } from './config';
import { startWebVitalsReporting } from './web-vitals';

let provider: WebTracerProvider | undefined;
let meterProvider: MeterProvider | undefined;
let stopWebVitals: (() => void) | undefined;
let removeErrorHandlers: (() => void) | undefined;

/** Errors captured while no span was active, recorded as a singleton span. */
let bufferedErrors: Array<Error | unknown> = [];

/**
 * Returns whether the telemetry SDK has been initialized (and so spans are
 * being collected).
 */
export function isTelemetryActive(): boolean {
  return provider !== undefined;
}

/**
 * Initializes the web SDK: zone context manager, tracer provider with OTLP
 * export, meter provider (so web-vitals metrics are exported, not dropped into
 * the no-op meter), W3C trace context propagation, network/page-load/interaction
 * instrumentations, web-vitals metrics and global error capture.
 *
 * Idempotent. Does nothing (and never touches globals) when the config or the
 * environment opts out.
 */
export async function initTelemetry(
  configOverride?: TelemetryConfig,
): Promise<void> {
  if (provider !== undefined) {
    return;
  }

  const config = configOverride ?? getTelemetryConfig();
  if (!isTelemetryEnabled(config)) {
    return;
  }

  const resource = resourceFromAttributes({
    'service.name': config.serviceName,
    'deployment.environment.name': import.meta.env.MODE ?? 'production',
  });

  const exporter = new OTLPTraceExporter({ url: config.tracesEndpoint });
  const webProvider = new WebTracerProvider({
    resource,
    // Sample roots by ratio while always keeping child spans of sampled
    // parent traces (e.g. traces that started at the API or a load balancer).
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.sampleRatio),
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  // Registers the global tracer provider, zone context manager and W3C trace
  // context propagator. The propagator lets the API server continue the same
  // trace across the browser -> API boundary (traceparent header on every
  // fetch).
  webProvider.register({
    contextManager: new ZoneContextManager(),
    propagator: new W3CTraceContextPropagator(),
  });
  provider = webProvider;

  // Register the global meter provider. Without this, `metrics.getMeter`
  // returns a no-op and web-vitals are silently discarded. Skipped when no
  // metrics endpoint is configured so export never targets an empty URL.
  if (config.metricsEndpoint !== undefined) {
    meterProvider = new MeterProvider({
      resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: config.metricsEndpoint }),
          exportIntervalMillis: 60_000,
        }),
      ],
    });
    metrics.setGlobalMeterProvider(meterProvider);
  }

  const instrumentations: Array<
    FetchInstrumentation | DocumentLoadInstrumentation | UserInteractionInstrumentation
  > = [
    new FetchInstrumentation({
      // Propagate W3C trace context to the API origin so browser spans and
      // API traces join up. Without this the default `[]` list means the
      // traceparent header is never sent on cross-origin fetches. Same-origin
      // requests always propagate regardless.
      propagateTraceHeaderCorsUrls: config.apiOrigin
        ? [new RegExp(config.apiOrigin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))]
        : [],
      clearTimingResources: true,
    }),
    new DocumentLoadInstrumentation(),
  ];
  if (config.enableInteractions) {
    instrumentations.push(new UserInteractionInstrumentation());
  }
  registerInstrumentations({ instrumentations });

  stopWebVitals = startWebVitalsReporting();
  removeErrorHandlers = installGlobalErrorHandlers();
}

/**
 * Flushes and shuts down the web SDK and removes error handlers. Safe to call
 * multiple times and when telemetry was never initialized.
 */
export async function shutdownTelemetry(): Promise<void> {
  stopWebVitals?.();
  removeErrorHandlers?.();
  stopWebVitals = undefined;
  removeErrorHandlers = undefined;

  flushBufferedErrors();

  const activeProvider = provider;
  provider = undefined;
  const activeMeterProvider = meterProvider;
  meterProvider = undefined;
  if (activeProvider !== undefined) {
    await activeProvider.shutdown();
  }
  if (activeMeterProvider !== undefined) {
    await activeMeterProvider.shutdown();
  }
}

export interface GlobalErrorHandlersOptions {
  /** Invoked for every captured error (testing hook). */
  onError?: (error: Error | unknown, type: 'error' | 'unhandledrejection') => void;
}

/**
 * Captures window `error` and `unhandledrejection` events, records them as
 * exceptions on the active span, and marks that span failed. Returns a cleanup
 * function that removes the listeners.
 */
export function installGlobalErrorHandlers(
  options: GlobalErrorHandlersOptions = {},
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const toError = (value: unknown): Error | unknown => {
    if (value instanceof Error) {
      return value;
    }
    if (typeof value === 'string') {
      return new Error(value);
    }
    return value;
  };

  const onError = (event: ErrorEvent) => {
    const error = toError(event.error ?? event.message);
    recordError(error);
    options.onError?.(error, 'error');
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const error = toError(event.reason);
    recordError(error);
    options.onError?.(error, 'unhandledrejection');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

/** Upper bound on errors buffered when no span is active, to bound memory. */
const MAX_BUFFERED_ERRORS = 20;

/**
 * Records an exception on the active span. When no span is active (the common
 * case for window-level errors fired between navigations) the error is
 * buffered and exported as its own span at shutdown, so it is not lost.
 */
function recordError(error: unknown): void {
  const activeSpan = trace.getSpan(context.active());
  if (activeSpan === undefined) {
    if (bufferedErrors.length < MAX_BUFFERED_ERRORS) {
      bufferedErrors.push(error);
    }
    return;
  }
  if (error instanceof Error) {
    activeSpan.recordException(error);
  } else {
    activeSpan.recordException({ message: String(error) });
  }
  activeSpan.setStatus({ code: SpanStatusCode.ERROR });
}

/** Exports each buffered error as a standalone `app.unhandled_error` span. */
function flushBufferedErrors(): void {
  const pending = bufferedErrors;
  bufferedErrors = [];
  if (pending.length === 0 || provider === undefined) {
    return;
  }
  const tracer = trace.getTracer('train-tracker-web');
  for (const error of pending) {
    const span = tracer.startSpan('app.unhandled_error', {
      attributes: { 'error.type': 'window' },
    });
    if (error instanceof Error) {
      span.recordException(error);
    } else {
      span.recordException({ message: String(error) });
    }
    span.setStatus({ code: SpanStatusCode.ERROR });
    span.end();
  }
}

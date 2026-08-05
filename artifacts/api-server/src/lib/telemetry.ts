import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import {
  NodeSDK,
  tracing,
  type NodeSDKConfiguration,
} from "@opentelemetry/sdk-node";
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME } from "@opentelemetry/semantic-conventions";
import { logger } from "./logger";
import { redactUrl } from "./trace-attributes";

const DEFAULT_SERVICE_NAME = "train-tracker-api";
const DEFAULT_OTLP_ENDPOINT = "http://localhost:4318";
const DEFAULT_SAMPLE_RATIO = 1;
const DEFAULT_METRIC_EXPORT_INTERVAL_MS = 60_000;
const DEFAULT_ENVIRONMENT = "development";

const ENABLING_EXPORTER_VALUES = new Set(["otlp", "console"]);

/**
 * Parsed OpenTelemetry configuration for the API server.
 *
 * All fields are derived from `OTEL_*` (and `NODE_ENV`) environment
 * variables; see {@link parseTelemetryConfig}.
 */
export interface TelemetryConfig {
  /** Whether telemetry should be initialized at all. */
  enabled: boolean;
  /** `service.name` resource attribute. */
  serviceName: string;
  /** `deployment.environment.name` resource attribute. */
  environment: string;
  /** Full OTLP/HTTP endpoint for traces (always ends in `/v1/traces`). */
  tracesEndpoint?: string;
  /** Full OTLP/HTTP endpoint for metrics (always ends in `/v1/metrics`). */
  metricsEndpoint?: string;
  /** Extra HTTP headers sent to the OTLP endpoints. */
  headers?: Record<string, string>;
  /** Root span sample ratio in `[0, 1]`; incoming sampled traces are honored. */
  traceSampleRatio: number;
  /** How often metric data is collected and exported, in milliseconds. */
  metricExportIntervalMs: number;
  /** Whether node auto-instrumentations should be registered. */
  enableInstrumentations: boolean;
  /**
   * Custom trace exporter (e.g. in-memory in tests). Defaults to OTLP/HTTP.
   */
  traceExporter?: NodeSDKConfiguration["traceExporter"];
  /**
   * Custom metric readers (e.g. in-memory in tests). Defaults to a single
   * periodic OTLP/HTTP reader.
   */
  metricReaders?: NodeSDKConfiguration["metricReaders"];
}

let sdk: NodeSDK | undefined;
let activeConfig: TelemetryConfig | undefined;

/**
 * Returns whether an exporter env value (`OTEL_TRACES_EXPORTER` /
 * `OTEL_METRICS_EXPORTER`) opts in to telemetry.
 */
function isEnablingExporter(raw: string | undefined): boolean {
  if (raw === undefined) {
    return false;
  }
  return raw
    .split(",")
    .some((token) => ENABLING_EXPORTER_VALUES.has(token.trim().toLowerCase()));
}

/** Parses `k1=v1,k2=v2` into a headers record; empty input yields `undefined`. */
function parseHeaders(
  raw: string | undefined,
): Record<string, string> | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    headers[trimmed.slice(0, eqIndex).trim()] = trimmed
      .slice(eqIndex + 1)
      .trim();
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** Parses a float in `[0, 1]`; invalid/missing values fall back to the default. */
function parseSampleRatio(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_SAMPLE_RATIO;
  }
  const ratio = Number(raw);
  if (Number.isNaN(ratio) || ratio < 0 || ratio > 1) {
    return DEFAULT_SAMPLE_RATIO;
  }
  return ratio;
}

/** Parses a positive integer; invalid/missing values fall back to the default. */
function parseMetricInterval(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_METRIC_EXPORT_INTERVAL_MS;
  }
  const interval = Number(raw);
  if (Number.isNaN(interval) || !Number.isFinite(interval) || interval <= 0) {
    return DEFAULT_METRIC_EXPORT_INTERVAL_MS;
  }
  return Math.floor(interval);
}

/**
 * Builds a {@link TelemetryConfig} from environment variables.
 *
 * Pure: performs no reads of the actual process environment and has no side
 * effects.
 */
export function parseTelemetryConfig(
  env: Record<string, string | undefined>,
): TelemetryConfig {
  const endpointRaw = env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  const baseEndpoint =
    endpointRaw !== undefined && endpointRaw.trim() !== ""
      ? endpointRaw
      : DEFAULT_OTLP_ENDPOINT;

  const tracesEndpointRaw = env["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"];
  const metricsEndpointRaw = env["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT"];

  const enabled =
    env["OTEL_ENABLED"] === "true" ||
    (endpointRaw !== undefined && endpointRaw.trim() !== "") ||
    (tracesEndpointRaw !== undefined && tracesEndpointRaw.trim() !== "") ||
    (metricsEndpointRaw !== undefined && metricsEndpointRaw.trim() !== "") ||
    isEnablingExporter(env["OTEL_TRACES_EXPORTER"]) ||
    isEnablingExporter(env["OTEL_METRICS_EXPORTER"]);

  return {
    enabled,
    serviceName: env["OTEL_SERVICE_NAME"] ?? DEFAULT_SERVICE_NAME,
    environment: env["NODE_ENV"] ?? DEFAULT_ENVIRONMENT,
    tracesEndpoint:
      tracesEndpointRaw !== undefined && tracesEndpointRaw.trim() !== ""
        ? tracesEndpointRaw
        : `${baseEndpoint}/v1/traces`,
    metricsEndpoint:
      metricsEndpointRaw !== undefined && metricsEndpointRaw.trim() !== ""
        ? metricsEndpointRaw
        : `${baseEndpoint}/v1/metrics`,
    headers: parseHeaders(env["OTEL_EXPORTER_OTLP_HEADERS"]),
    traceSampleRatio: parseSampleRatio(env["OTEL_TRACE_SAMPLE_RATIO"]),
    metricExportIntervalMs: parseMetricInterval(
      env["OTEL_METRIC_EXPORT_INTERVAL_MS"],
    ),
    enableInstrumentations: env["OTEL_INSTRUMENTATIONS_ENABLED"] !== "false",
  };
}

/**
 * Returns true once the SDK has been initialized or the current config/environment
 * opts in to telemetry.
 */
export function isTelemetryEnabled(): boolean {
  if (sdk !== undefined) {
    return true;
  }
  if (activeConfig?.enabled === true) {
    return true;
  }
  return parseTelemetryConfig(process.env).enabled;
}

/** Node auto-instrumentations with pino disabled (pino is bundled and
 * unpatchable) and the HTTP request URL redacted to its path. */
function buildInstrumentations() {
  return getNodeAutoInstrumentations({
    "@opentelemetry/instrumentation-pino": { enabled: false },
    "@opentelemetry/instrumentation-http": {
      applyCustomAttributesOnSpan: (span, request) => {
        // `request` is an IncomingMessage (server) or ClientRequest (client);
        // both expose the request target as a string. `redactUrl` keeps the
        // path and drops the query string, which carries user input.
        const candidate =
          (request as { url?: unknown }).url ??
          (request as { path?: unknown }).path;
        if (typeof candidate === "string") {
          span.setAttribute("http.url", redactUrl(candidate));
        }
      },
    },
  });
}

/** Resource = default resource + deployment environment name. */
function buildResource(cfg: TelemetryConfig) {
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: cfg.environment,
    }),
  );
}

/** Constructs the {@link NodeSDK} from a parsed config. */
function buildSdk(cfg: TelemetryConfig): NodeSDK {
  const sampler = new tracing.ParentBasedSampler({
    root: new tracing.TraceIdRatioBasedSampler(cfg.traceSampleRatio),
  });

  const spanExporter =
    cfg.traceExporter ??
    new OTLPTraceExporter({
      url: cfg.tracesEndpoint,
      headers: cfg.headers,
    });
  const metricReaders = cfg.metricReaders ?? [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({
        url: cfg.metricsEndpoint,
        headers: cfg.headers,
      }),
      exportIntervalMillis: cfg.metricExportIntervalMs,
    }),
  ];

  return new NodeSDK({
    serviceName: cfg.serviceName,
    resource: buildResource(cfg),
    sampler,
    traceExporter: spanExporter,
    metricReaders,
    instrumentations: cfg.enableInstrumentations ? buildInstrumentations() : [],
    autoDetectResources: true,
  });
}

/**
 * Initializes the OpenTelemetry SDK and registers the global tracer/meter
 * providers, if telemetry is enabled. Idempotent; when disabled this is a
 * cheap no-op that leaves `@opentelemetry/api` on its no-op providers.
 */
export async function initTelemetry(
  configOverride?: TelemetryConfig,
): Promise<void> {
  if (sdk !== undefined) {
    return;
  }
  const cfg = configOverride ?? parseTelemetryConfig(process.env);
  activeConfig = cfg;
  if (!cfg.enabled) {
    return;
  }
  const nodeSdk = buildSdk(cfg);
  nodeSdk.start();
  sdk = nodeSdk;
}

/**
 * Flushes and shuts down the telemetry SDK, restoring the no-op state. Safe to
 * call multiple times and when telemetry was never initialized. Exporter
 * failures during the final flush are logged but never thrown, so a down
 * collector cannot crash the shutdown path.
 */
export async function shutdownTelemetry(): Promise<void> {
  activeConfig = undefined;
  if (sdk === undefined) {
    return;
  }
  const nodeSdk = sdk;
  sdk = undefined;
  try {
    await nodeSdk.shutdown();
  } catch (err) {
    logger.error({ err }, "Error during telemetry shutdown");
  }
}

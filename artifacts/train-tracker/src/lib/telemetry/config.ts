/**
 * Frontend telemetry (RUM / web-vitals) configuration.
 *
 * Parsed purely from Vite env vars so that the SDK wiring in `index.ts` never
 * reads `import.meta.env` directly and stays unit-testable.
 */

export interface TelemetryConfig {
  /** Master switch; telemetry is inert when false. */
  enabled: boolean;
  /** `service.name` resource attribute attached to all signals. */
  serviceName: string;
  /** Full OTLP/HTTP trace endpoint (per-signal URL, wins over base). */
  tracesEndpoint?: string;
  /** Probability (0-1) that a root trace is sampled. Invalid values fall back to 1. */
  sampleRatio: number;
  /** Whether user-interaction spans (clicks, etc.) are captured. */
  enableInteractions: boolean;
  /** Raw base collector endpoint (`VITE_OTEL_EXPORTER_OTLP_ENDPOINT`). */
  collectorEndpoint?: string;
}

export const DEFAULT_SERVICE_NAME = 'train-tracker-web';
export const DEFAULT_SAMPLE_RATIO = 1;

/** Vite env var names consumed by the SPA. */
export const TELEMETRY_ENV = {
  enabled: 'VITE_OTEL_ENABLED',
  tracesEndpoint: 'VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  collectorEndpoint: 'VITE_OTEL_EXPORTER_OTLP_ENDPOINT',
  serviceName: 'VITE_OTEL_SERVICE_NAME',
  sampleRatio: 'VITE_OTEL_TRACE_SAMPLE_RATIO',
  enableInteractions: 'VITE_OTEL_ENABLE_INTERACTIONS',
} as const;

function isTrue(value: string | undefined): boolean {
  return value === 'true';
}

/**
 * Parses a trace sample ratio. Returns `fallback` when the value is missing,
 * not a finite number, or outside [0, 1].
 */
export function parseSampleRatio(
  value: string | undefined,
  fallback: number = DEFAULT_SAMPLE_RATIO,
): number {
  if (value === undefined) return fallback;
  const ratio = Number(value);
  if (Number.isNaN(ratio) || ratio < 0 || ratio > 1) return fallback;
  return ratio;
}

/**
 * Parses the telemetry configuration from a raw env record (pure function).
 *
 * Endpoint precedence: `VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` (per-signal)
 * overrides `VITE_OTEL_EXPORTER_OTLP_ENDPOINT` (base), which is treated as the
 * traces endpoint directly.
 */
export function parseTelemetryConfig(
  env: Record<string, string | undefined>,
): TelemetryConfig {
  const tracesEndpoint =
    env[TELEMETRY_ENV.tracesEndpoint] ?? env[TELEMETRY_ENV.collectorEndpoint];
  return {
    enabled: isTrue(env[TELEMETRY_ENV.enabled]),
    serviceName: env[TELEMETRY_ENV.serviceName] ?? DEFAULT_SERVICE_NAME,
    tracesEndpoint: tracesEndpoint === undefined ? undefined : tracesEndpoint,
    sampleRatio: parseSampleRatio(env[TELEMETRY_ENV.sampleRatio]),
    enableInteractions: isTrue(env[TELEMETRY_ENV.enableInteractions]),
    collectorEndpoint: env[TELEMETRY_ENV.collectorEndpoint],
  };
}

/**
 * True when telemetry is both enabled by flag and has somewhere to send spans.
 */
export function isTelemetryEnabled(config: TelemetryConfig): boolean {
  return config.enabled && config.tracesEndpoint !== undefined;
}

/**
 * Parses the config from `import.meta.env` (or a provided env override).
 */
export function getTelemetryConfig(
  env: Record<string, string | undefined> = import.meta.env,
): TelemetryConfig {
  return parseTelemetryConfig(env);
}

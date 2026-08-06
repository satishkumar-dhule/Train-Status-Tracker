import { afterEach, describe, expect, it, vi } from "vitest";
import { metrics, trace } from "@opentelemetry/api";
import {
  metrics as sdkMetrics,
  tracing as sdkTracing,
} from "@opentelemetry/sdk-node";
import { logger } from "./logger";
import {
  buildResource,
  initTelemetry,
  isTelemetryEnabled,
  parseTelemetryConfig,
  shutdownTelemetry,
  type TelemetryConfig,
} from "./telemetry";

const EMPTY_ENV: Record<string, string | undefined> = {};

function enabledConfig(
  overrides: Partial<TelemetryConfig> = {},
): TelemetryConfig {
  const spanExporter = new sdkTracing.InMemorySpanExporter();
  const metricExporter = new sdkMetrics.InMemoryMetricExporter(
    sdkMetrics.AggregationTemporality.CUMULATIVE,
  );
  return {
    enabled: true,
    serviceName: "test-service",
    environment: "test",
    tracesEndpoint: "http://127.0.0.1:4318/v1/traces",
    metricsEndpoint: "http://127.0.0.1:4318/v1/metrics",
    headers: { Authorization: "Bearer test-token" },
    traceSampleRatio: 1,
    metricExportIntervalMs: 60_000,
    enableInstrumentations: false,
    traceExporter: spanExporter,
    metricReaders: [
      new sdkMetrics.PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 60_000,
      }),
    ],
    ...overrides,
  };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await shutdownTelemetry();
});

describe("parseTelemetryConfig", () => {
  it("disables telemetry when nothing opts in", () => {
    expect(parseTelemetryConfig(EMPTY_ENV).enabled).toBe(false);
  });

  it.each([
    ["OTEL_ENABLED", "true"],
    ["OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318"],
    ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", "http://collector:4318/v1/traces"],
    ["OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "http://collector:4318/v1/metrics"],
    ["OTEL_TRACES_EXPORTER", "otlp"],
    ["OTEL_METRICS_EXPORTER", "console"],
  ])("enables when %s is set to %s", (key, value) => {
    expect(parseTelemetryConfig({ [key]: value }).enabled).toBe(true);
  });

  it("enables when an exporter list contains an enabling value", () => {
    expect(
      parseTelemetryConfig({ OTEL_TRACES_EXPORTER: "console,otlp" }).enabled,
    ).toBe(true);
  });

  it("does not enable for non-enabling exporter values", () => {
    const cfg = parseTelemetryConfig({
      OTEL_TRACES_EXPORTER: "jaeger",
      OTEL_METRICS_EXPORTER: "none",
    });
    expect(cfg.enabled).toBe(false);
  });

  it("uses default endpoints when unspecified", () => {
    const cfg = parseTelemetryConfig({ OTEL_ENABLED: "true" });
    expect(cfg.tracesEndpoint).toBe("http://localhost:4318/v1/traces");
    expect(cfg.metricsEndpoint).toBe("http://localhost:4318/v1/metrics");
  });

  it("appends signal paths to the base endpoint", () => {
    const cfg = parseTelemetryConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
    });
    expect(cfg.tracesEndpoint).toBe("http://collector:4318/v1/traces");
    expect(cfg.metricsEndpoint).toBe("http://collector:4318/v1/metrics");
  });

  it("honors per-signal endpoint overrides", () => {
    const cfg = parseTelemetryConfig({
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://traces.internal/v1/traces",
    });
    expect(cfg.tracesEndpoint).toBe("http://traces.internal/v1/traces");
    expect(cfg.metricsEndpoint).toBe("http://collector:4318/v1/metrics");
  });

  it("parses OTLP headers", () => {
    const cfg = parseTelemetryConfig({
      OTEL_ENABLED: "true",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer token, X-Key=a=b",
    });
    expect(cfg.headers).toEqual({
      Authorization: "Bearer token",
      "X-Key": "a=b",
    });
  });

  it("returns undefined headers for empty input", () => {
    const cfg = parseTelemetryConfig({
      OTEL_ENABLED: "true",
      OTEL_EXPORTER_OTLP_HEADERS: "",
    });
    expect(cfg.headers).toBeUndefined();
  });

  it("skips malformed header pairs", () => {
    const cfg = parseTelemetryConfig({
      OTEL_ENABLED: "true",
      OTEL_EXPORTER_OTLP_HEADERS: "=novalue,novalue,ok=yes",
    });
    expect(cfg.headers).toEqual({ ok: "yes" });
  });

  it("defaults service name and environment", () => {
    const cfg = parseTelemetryConfig(EMPTY_ENV);
    expect(cfg.serviceName).toBe("train-tracker-api");
    expect(cfg.environment).toBe("development");
  });

  it("reads service name and environment overrides", () => {
    const cfg = parseTelemetryConfig({
      OTEL_SERVICE_NAME: "custom",
      NODE_ENV: "production",
    });
    expect(cfg.serviceName).toBe("custom");
    expect(cfg.environment).toBe("production");
  });

  it("leaves version unset when SERVICE_VERSION is absent", () => {
    expect(parseTelemetryConfig(EMPTY_ENV).version).toBeUndefined();
  });

  it("reads SERVICE_VERSION into the version field", () => {
    expect(
      parseTelemetryConfig({ SERVICE_VERSION: "1.2.3" }).version,
    ).toBe("1.2.3");
  });

  it("defaults the trace sample ratio to 1", () => {
    expect(parseTelemetryConfig(EMPTY_ENV).traceSampleRatio).toBe(1);
  });

  it.each(["0", "0.5", "1"])("parses a valid sample ratio %s", (value) => {
    expect(
      parseTelemetryConfig({ OTEL_TRACE_SAMPLE_RATIO: value }).traceSampleRatio,
    ).toBe(Number(value));
  });

  it.each(["abc", "-1", "1.5", "NaN"])(
    "falls back to the default for invalid sample ratio %s",
    (value) => {
      expect(
        parseTelemetryConfig({ OTEL_TRACE_SAMPLE_RATIO: value })
          .traceSampleRatio,
      ).toBe(1);
    },
  );

  it("defaults the metric export interval to 60000", () => {
    expect(parseTelemetryConfig(EMPTY_ENV).metricExportIntervalMs).toBe(60_000);
  });

  it("parses a valid metric export interval", () => {
    expect(
      parseTelemetryConfig({ OTEL_METRIC_EXPORT_INTERVAL_MS: "15000" })
        .metricExportIntervalMs,
    ).toBe(15_000);
  });

  it.each(["abc", "0", "-100", "Infinity"])(
    "falls back to the default for invalid interval %s",
    (value) => {
      expect(
        parseTelemetryConfig({ OTEL_METRIC_EXPORT_INTERVAL_MS: value })
          .metricExportIntervalMs,
      ).toBe(60_000);
    },
  );

  it("enables instrumentations by default", () => {
    expect(parseTelemetryConfig(EMPTY_ENV).enableInstrumentations).toBe(true);
  });

  it("disables instrumentations when explicitly turned off", () => {
    expect(
      parseTelemetryConfig({ OTEL_INSTRUMENTATIONS_ENABLED: "false" })
        .enableInstrumentations,
    ).toBe(false);
  });
});

describe("isTelemetryEnabled", () => {
  it("returns false when never initialized and no env opts in", () => {
    expect(isTelemetryEnabled()).toBe(false);
  });
});

describe("initTelemetry", () => {
  describe("disabled path", () => {
    it("stays a no-op without enabling env and keeps the API no-op", async () => {
      await initTelemetry();
      expect(isTelemetryEnabled()).toBe(false);

      const tracer = trace.getTracer("telemetry-noop");
      expect(typeof tracer.startSpan).toBe("function");
      const span = tracer.startSpan("noop-span");
      expect(trace.getActiveSpan()).toBeUndefined();
      expect(span.spanContext().traceId).toBe(
        "00000000000000000000000000000000",
      );

      const meter = metrics.getMeter("telemetry-noop");
      expect(typeof meter.createCounter).toBe("function");
      meter.createCounter("noop.counter").add(1);
    });
  });

  describe("enabled path", () => {
    it("registers global providers and exports spans", async () => {
      vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "10");
      const config = enabledConfig();
      const spanExporter = config.traceExporter as sdkTracing.InMemorySpanExporter;
      try {
        await initTelemetry(config);
        expect(isTelemetryEnabled()).toBe(true);

        const tracer = trace.getTracer("telemetry-init");
        const span = tracer.startSpan("init-span");
        expect(span.isRecording()).toBe(true);
        span.end();

        // InMemorySpanExporter.shutdown() clears its buffer, so assert while
        // the SDK is still up. A 10ms OTEL_BSP_SCHEDULE_DELAY makes the
        // BatchSpanProcessor flush the finished span well within this window.
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(spanExporter.getFinishedSpans().length).toBeGreaterThan(0);

        const meter = metrics.getMeter("telemetry-init");
        const counter = meter.createCounter("init.test.counter");
        expect(counter).toBeDefined();
        counter.add(1);

        await initTelemetry(enabledConfig());
        expect(isTelemetryEnabled()).toBe(true);
      } finally {
        await shutdownTelemetry();
      }
    });

    it("initializes from environment variables", async () => {
      try {
        vi.stubEnv("OTEL_ENABLED", "true");
        vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://127.0.0.1:4318");
        vi.stubEnv("OTEL_INSTRUMENTATIONS_ENABLED", "false");

        const config: TelemetryConfig = {
          ...parseTelemetryConfig(process.env),
          traceExporter: new sdkTracing.InMemorySpanExporter(),
          metricReaders: [
            new sdkMetrics.PeriodicExportingMetricReader({
              exporter: new sdkMetrics.InMemoryMetricExporter(
                sdkMetrics.AggregationTemporality.CUMULATIVE,
              ),
              exportIntervalMillis: 60_000,
            }),
          ],
        };

        await initTelemetry(config);
        expect(isTelemetryEnabled()).toBe(true);
        expect(
          trace.getTracer("telemetry-env").startSpan("env-span").isRecording(),
        ).toBe(true);
      } finally {
        await shutdownTelemetry();
      }
    });

    it("logs startup details including the service version", async () => {
      const infoSpy = vi.spyOn(logger, "info");
      try {
        await initTelemetry(enabledConfig({ version: "2.0.0" }));
        const call = infoSpy.mock.calls.find(([payload]) => {
          const fields = payload as Record<string, unknown>;
          return (
            typeof fields === "object" &&
            fields !== null &&
            fields.serviceName === "test-service"
          );
        });
        expect(call).toBeDefined();
        const logged = (call?.[0] ?? {}) as Record<string, unknown>;
        expect(logged.serviceVersion).toBe("2.0.0");
        expect(logged.environment).toBe("test");
        expect(logged.tracesEndpoint).toMatch(/\/v1\/traces$/);
      } finally {
        await shutdownTelemetry();
      }
    });

    it("sets the service.version resource attribute", () => {
      const resource = buildResource(enabledConfig({ version: "3.1.4" }));
      expect(resource.attributes["service.version"]).toBe("3.1.4");
      expect(resource.attributes["deployment.environment.name"]).toBe("test");
    });

    it("reports disabled again after shutdown", async () => {
      try {
        await initTelemetry(enabledConfig());
        expect(isTelemetryEnabled()).toBe(true);
      } finally {
        await shutdownTelemetry();
      }
      expect(isTelemetryEnabled()).toBe(false);
    });
  });
});

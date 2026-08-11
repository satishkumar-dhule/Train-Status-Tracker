import { expect, it, vi } from "vitest";
import { metrics as sdkMetrics, tracing as sdkTracing } from "@opentelemetry/sdk-node";
import { trace } from "@opentelemetry/api";
import {
  initTelemetry,
  shutdownTelemetry,
  type TelemetryConfig,
} from "./telemetry";

it("debug resource attrs", async () => {
  vi.stubEnv("OTEL_BSP_SCHEDULE_DELAY", "10");
  const config: TelemetryConfig = {
    enabled: true,
    serviceName: "test-service",
    environment: "test",
    tracesEndpoint: "http://127.0.0.1:4318/v1/traces",
    metricsEndpoint: "http://127.0.0.1:4318/v1/metrics",
    headers: { Authorization: "Bearer test-token" },
    traceSampleRatio: 1,
    metricExportIntervalMs: 60_000,
    enableInstrumentations: false,
    version: "3.1.4",
    traceExporter: new sdkTracing.InMemorySpanExporter(),
    metricReaders: [
      new sdkMetrics.PeriodicExportingMetricReader({
        exporter: new sdkMetrics.InMemoryMetricExporter(sdkMetrics.AggregationTemporality.CUMULATIVE),
        exportIntervalMillis: 60_000,
      }),
    ],
  };
  try {
    await initTelemetry(config);
    const span = trace.getTracer("dbg").startSpan("s");
    span.end();
    await new Promise((r) => setTimeout(r, 120));
    const spans = (config.traceExporter as sdkTracing.InMemorySpanExporter).getFinishedSpans();
    process.stderr.write("SPANS=" + spans.length + " KEYS=" + JSON.stringify(Object.keys(spans[0]?.resource.attributes ?? {})) + "\n");
  } finally {
    await shutdownTelemetry();
  }
  expect(true).toBe(true);
});

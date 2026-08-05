import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAMPLE_RATIO,
  DEFAULT_SERVICE_NAME,
  getTelemetryConfig,
  isTelemetryEnabled,
  parseSampleRatio,
  parseTelemetryConfig,
  type TelemetryConfig,
} from "./config";

function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return { ...overrides };
}

describe("parseTelemetryConfig", () => {
  it("defaults to disabled with no OTel env vars", () => {
    const config = parseTelemetryConfig(env());
    expect(config.enabled).toBe(false);
    expect(config.serviceName).toBe(DEFAULT_SERVICE_NAME);
    expect(config.tracesEndpoint).toBeUndefined();
    expect(config.collectorEndpoint).toBeUndefined();
    expect(config.sampleRatio).toBe(DEFAULT_SAMPLE_RATIO);
    expect(config.enableInteractions).toBe(false);
  });

  it("is disabled unless the enabled flag is exactly true", () => {
    expect(parseTelemetryConfig(env({ VITE_OTEL_ENABLED: "yes" })).enabled).toBe(false);
    expect(parseTelemetryConfig(env({ VITE_OTEL_ENABLED: "TRUE" })).enabled).toBe(false);
    expect(parseTelemetryConfig(env({ VITE_OTEL_ENABLED: "true" })).enabled).toBe(true);
  });

  it("uses the per-signal endpoint when set", () => {
    const config = parseTelemetryConfig(
      env({
        VITE_OTEL_ENABLED: "true",
        VITE_OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.example/v1/traces",
        VITE_OTEL_EXPORTER_OTLP_ENDPOINT: "https://base.example/v1/traces",
      }),
    );
    expect(config.tracesEndpoint).toBe("https://collector.example/v1/traces");
  });

  it("falls back to the base collector endpoint", () => {
    const config = parseTelemetryConfig(
      env({
        VITE_OTEL_ENABLED: "true",
        VITE_OTEL_EXPORTER_OTLP_ENDPOINT: "https://base.example/v1/traces",
      }),
    );
    expect(config.tracesEndpoint).toBe("https://base.example/v1/traces");
  });

  it("honors the service name override", () => {
    const config = parseTelemetryConfig(
      env({ VITE_OTEL_SERVICE_NAME: "my-app-web" }),
    );
    expect(config.serviceName).toBe("my-app-web");
  });

  it("parses the interaction flag", () => {
    expect(parseTelemetryConfig(env({ VITE_OTEL_ENABLE_INTERACTIONS: "true" })).enableInteractions).toBe(true);
    expect(parseTelemetryConfig(env({ VITE_OTEL_ENABLE_INTERACTIONS: "false" })).enableInteractions).toBe(false);
  });
});

describe("parseSampleRatio", () => {
  it("returns the fallback for missing or invalid values", () => {
    expect(parseSampleRatio(undefined)).toBe(1);
    expect(parseSampleRatio("abc")).toBe(1);
    expect(parseSampleRatio("1.5")).toBe(1);
    expect(parseSampleRatio("-1")).toBe(1);
  });

  it("parses valid ratios in range", () => {
    expect(parseSampleRatio("0")).toBe(0);
    expect(parseSampleRatio("0.25")).toBe(0.25);
    expect(parseSampleRatio("1")).toBe(1);
  });
});

describe("isTelemetryEnabled", () => {
  it("requires both the flag and a trace endpoint", () => {
    expect(isTelemetryEnabled(parseTelemetryConfig(env({ VITE_OTEL_ENABLED: "true" })))).toBe(false);
    expect(
      isTelemetryEnabled(
        parseTelemetryConfig(
          env({
            VITE_OTEL_ENABLED: "true",
            VITE_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/v1/traces",
          }),
        ),
      ),
    ).toBe(true);
    expect(
      isTelemetryEnabled(
        parseTelemetryConfig(env({ VITE_OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/v1/traces" })),
      ),
    ).toBe(false);
  });
});

describe("getTelemetryConfig", () => {
  it("parses from a provided env record", () => {
    const config: TelemetryConfig = getTelemetryConfig(
      env({ VITE_OTEL_ENABLED: "true", VITE_OTEL_SERVICE_NAME: "x" }),
    );
    expect(config.enabled).toBe(true);
    expect(config.serviceName).toBe("x");
  });
});

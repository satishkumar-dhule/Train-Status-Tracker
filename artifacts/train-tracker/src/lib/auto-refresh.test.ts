import { describe, expect, it } from "vitest";
import {
  AUTO_REFRESH_INTERVAL_ENV,
  DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  getAutoRefreshIntervalMs,
  parseAutoRefreshIntervalMs,
} from "./auto-refresh";
import { parseEnvMs, readEnvMs } from "./env";

describe("parseEnvMs", () => {
  it("returns the fallback for missing, non-numeric, or non-positive values", () => {
    expect(parseEnvMs(undefined, 42)).toBe(42);
    expect(parseEnvMs("abc", 42)).toBe(42);
    expect(parseEnvMs("0", 42)).toBe(42);
    expect(parseEnvMs("-1000", 42)).toBe(42);
  });

  it("parses valid positive millisecond values and rounds them", () => {
    expect(parseEnvMs("300000", 42)).toBe(300000);
    expect(parseEnvMs("29999.6", 42)).toBe(30000);
  });
});

describe("readEnvMs", () => {
  it("reads a positive value from the env record", () => {
    expect(readEnvMs({ TTL: "120000" }, "TTL", 42)).toBe(120000);
  });

  it("falls back when the env key is absent", () => {
    expect(readEnvMs({}, "TTL", 42)).toBe(42);
  });
});

describe("parseAutoRefreshIntervalMs", () => {
  it("defaults to 30 seconds when no value is provided", () => {
    expect(parseAutoRefreshIntervalMs(undefined)).toBe(30_000);
  });

  it("returns the fallback for missing, non-numeric, or non-positive values", () => {
    expect(parseAutoRefreshIntervalMs("abc")).toBe(
      DEFAULT_AUTO_REFRESH_INTERVAL_MS,
    );
    expect(parseAutoRefreshIntervalMs("0")).toBe(
      DEFAULT_AUTO_REFRESH_INTERVAL_MS,
    );
    expect(parseAutoRefreshIntervalMs("-1000")).toBe(
      DEFAULT_AUTO_REFRESH_INTERVAL_MS,
    );
    expect(parseAutoRefreshIntervalMs("", 42)).toBe(42);
  });

  it("parses valid millisecond values", () => {
    expect(parseAutoRefreshIntervalMs("60000")).toBe(60000);
  });
});

describe("getAutoRefreshIntervalMs", () => {
  it("reads VITE_AUTO_REFRESH_INTERVAL_MS from the env record", () => {
    expect(
      getAutoRefreshIntervalMs({ [AUTO_REFRESH_INTERVAL_ENV]: "15000" }),
    ).toBe(15000);
  });

  it("falls back to the default when the env var is absent", () => {
    expect(getAutoRefreshIntervalMs({})).toBe(DEFAULT_AUTO_REFRESH_INTERVAL_MS);
  });
});

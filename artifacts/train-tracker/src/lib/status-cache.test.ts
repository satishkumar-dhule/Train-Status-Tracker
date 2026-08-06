import { describe, expect, it } from "vitest";
import {
  DEFAULT_STATUS_CACHE_TTL_MS,
  getStatusCacheTtlMs,
  parseStatusCacheTtlMs,
  STATUS_CACHE_TTL_ENV,
} from "./status-cache";

function env(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return { ...overrides };
}

describe("parseStatusCacheTtlMs", () => {
  it("defaults to 5 minutes when no env var is set", () => {
    expect(parseStatusCacheTtlMs(undefined)).toBe(5 * 60 * 1000);
  });

  it("returns the fallback for missing, non-numeric, or non-positive values", () => {
    expect(parseStatusCacheTtlMs("abc")).toBe(DEFAULT_STATUS_CACHE_TTL_MS);
    expect(parseStatusCacheTtlMs("0")).toBe(DEFAULT_STATUS_CACHE_TTL_MS);
    expect(parseStatusCacheTtlMs("-1000")).toBe(DEFAULT_STATUS_CACHE_TTL_MS);
    expect(parseStatusCacheTtlMs("", 42)).toBe(42);
  });

  it("parses valid millisecond values", () => {
    expect(parseStatusCacheTtlMs("300000")).toBe(300000);
    expect(parseStatusCacheTtlMs("60000")).toBe(60000);
  });
});

describe("getStatusCacheTtlMs", () => {
  it("reads VITE_STATUS_CACHE_TTL_MS from the env record", () => {
    expect(
      getStatusCacheTtlMs(env({ [STATUS_CACHE_TTL_ENV]: "120000" })),
    ).toBe(120000);
  });

  it("falls back to the default when the env var is absent", () => {
    expect(getStatusCacheTtlMs(env())).toBe(DEFAULT_STATUS_CACHE_TTL_MS);
  });
});

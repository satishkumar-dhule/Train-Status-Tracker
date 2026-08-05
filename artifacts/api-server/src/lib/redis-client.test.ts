import { describe, expect, it } from "vitest";
import { parseRedisConfig } from "./redis-client";

const EMPTY: Record<string, string | undefined> = {};

const DEFAULT_URL = "redis://red-d9pf93e417fc73dppv4g:6379";
const DEFAULT_PROBE_MS = 15 * 60 * 1000;

describe("parseRedisConfig mode", () => {
  it("defaults to auto mode", () => {
    expect(parseRedisConfig(EMPTY).mode).toBe("auto");
  });

  it("accepts explicit auto via REDIS_MODE", () => {
    expect(parseRedisConfig({ REDIS_MODE: "auto" }).mode).toBe("auto");
    expect(
      parseRedisConfig({ REDIS_MODE: "AUTO" }).mode,
    ).toBe("auto");
  });

  it("maps REDIS_MODE enabled/on to enabled and disabled/off to disabled", () => {
    expect(parseRedisConfig({ REDIS_MODE: "enabled" }).mode).toBe("enabled");
    expect(parseRedisConfig({ REDIS_MODE: "on" }).mode).toBe("enabled");
    expect(parseRedisConfig({ REDIS_MODE: "disabled" }).mode).toBe("disabled");
    expect(parseRedisConfig({ REDIS_MODE: "off" }).mode).toBe("disabled");
  });

  it("falls back to auto for unknown REDIS_MODE values", () => {
    expect(parseRedisConfig({ REDIS_MODE: "sometimes" }).mode).toBe("auto");
  });

  it("honors REDIS_ENABLED for backward compatibility", () => {
    expect(
      parseRedisConfig({ REDIS_ENABLED: "true" }).mode,
    ).toBe("enabled");
    expect(
      parseRedisConfig({ REDIS_ENABLED: "false" }).mode,
    ).toBe("disabled");
  });

  it("treats a non-boolean REDIS_ENABLED as auto", () => {
    expect(parseRedisConfig({ REDIS_ENABLED: "1" }).mode).toBe("auto");
    expect(parseRedisConfig({ REDIS_ENABLED: "TRUE" }).mode).toBe("auto");
  });

  it("lets REDIS_MODE take precedence over REDIS_ENABLED", () => {
    const cfg = parseRedisConfig({
      REDIS_MODE: "disabled",
      REDIS_ENABLED: "true",
    });
    expect(cfg.mode).toBe("disabled");
  });
});

describe("parseRedisConfig url", () => {
  it("defaults to the internal Render endpoint", () => {
    expect(parseRedisConfig(EMPTY).url).toBe(DEFAULT_URL);
  });

  it("honors an explicit REDIS_URL override", () => {
    expect(
      parseRedisConfig({ REDIS_URL: "redis://cache.internal:6379" }).url,
    ).toBe("redis://cache.internal:6379");
  });

  it("ignores a blank REDIS_URL", () => {
    expect(parseRedisConfig({ REDIS_URL: "   " }).url).toBe(DEFAULT_URL);
  });
});

describe("parseRedisConfig timings", () => {
  it("defaults the re-probe interval to 15 minutes", () => {
    expect(parseRedisConfig(EMPTY).probeIntervalMs).toBe(DEFAULT_PROBE_MS);
  });

  it("honors REDIS_PROBE_INTERVAL_MS and rejects non-positive values", () => {
    expect(
      parseRedisConfig({ REDIS_PROBE_INTERVAL_MS: "60000" }).probeIntervalMs,
    ).toBe(60_000);
    expect(
      parseRedisConfig({ REDIS_PROBE_INTERVAL_MS: "0" }).probeIntervalMs,
    ).toBe(DEFAULT_PROBE_MS);
    expect(
      parseRedisConfig({ REDIS_PROBE_INTERVAL_MS: "abc" }).probeIntervalMs,
    ).toBe(DEFAULT_PROBE_MS);
  });

  it("defaults the command timeout and honors an override", () => {
    expect(parseRedisConfig(EMPTY).commandTimeoutMs).toBe(200);
    expect(
      parseRedisConfig({ REDIS_COMMAND_TIMEOUT_MS: "1500" }).commandTimeoutMs,
    ).toBe(1500);
  });
});

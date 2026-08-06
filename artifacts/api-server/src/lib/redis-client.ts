import Redis from "ioredis";
import { metrics } from "@opentelemetry/api";
import { logger } from "./logger";

/**
 * Minimal async key-value surface shared by the real ioredis-backed store and
 * test fakes. Values may be strings or raw Buffers (e.g. gzip-compressed
 * payloads). `set` receives an absolute TTL in seconds.
 */
export interface RedisStore {
  isAvailable(): boolean;
  get(key: string): Promise<string | Buffer | null>;
  set(key: string, value: string | Buffer, ttlSeconds: number): Promise<unknown>;
  close?(): Promise<unknown>;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 200;

/** How often an unreachable Redis is re-probed in auto mode. */
const DEFAULT_PROBE_INTERVAL_MS = 15 * 60 * 1000;

/** Accepted endpoint URL schemes. Anything else is a misconfiguration. */
const REDIS_URL_SCHEMES = ["redis://", "rediss://"];

const createdStores: { close?(): Promise<unknown> }[] = [];

export type RedisMode = "auto" | "enabled" | "disabled";

export interface RedisConfig {
  /**
   * - `auto` (default): Redis is used while reachable; on connection failure
   *   it is bypassed and re-probed every `probeIntervalMs`.
   * - `enabled`: always attempt to connect and use Redis (fail-open per op).
   * - `disabled`: never connect.
   */
  mode: RedisMode;
  /** Endpoint URL to connect to. */
  url: string;
  /** Per-command timeout in milliseconds. */
  commandTimeoutMs: number;
  /** Re-probe cadence in auto mode, in milliseconds. */
  probeIntervalMs: number;
}

/**
 * Parses Redis configuration from environment variables. Pure with respect to
 * `env`, so it is fully unit-testable.
 *
 * Mode resolution: `REDIS_MODE` wins when set (`auto` | `enabled`/`on` |
 * `disabled`/`off`). Otherwise `REDIS_ENABLED=true`/`false` opts in/out for
 * backward compatibility. With neither set, **auto** is the default, so the
 * cache engages by default and gracefully backs off when Redis is unreachable.
 *
 * There is deliberately no default endpoint: without a `REDIS_URL` (or when
 * the value is blank or not a `redis://`/`rediss://` URL) the mode resolves to
 * `disabled`, so a misconfigured process fails open instead of silently
 * talking to some unrelated host.
 */
export function parseRedisConfig(
  env: Record<string, string | undefined>,
): RedisConfig {
  const url = env.REDIS_URL?.trim() ?? "";
  const usableUrl =
    url !== "" &&
    REDIS_URL_SCHEMES.some((scheme) => url.startsWith(scheme));
  const rawProbe = Number(env.REDIS_PROBE_INTERVAL_MS ?? DEFAULT_PROBE_INTERVAL_MS);
  const rawTimeout = Number(
    env.REDIS_COMMAND_TIMEOUT_MS ?? DEFAULT_COMMAND_TIMEOUT_MS,
  );
  return {
    mode: usableUrl ? parseMode(env.REDIS_MODE, env.REDIS_ENABLED) : "disabled",
    url,
    commandTimeoutMs:
      Number.isFinite(rawTimeout) && rawTimeout > 0
        ? rawTimeout
        : DEFAULT_COMMAND_TIMEOUT_MS,
    probeIntervalMs:
      Number.isFinite(rawProbe) && rawProbe > 0
        ? rawProbe
        : DEFAULT_PROBE_INTERVAL_MS,
  };
}

function parseMode(
  modeRaw: string | undefined,
  enabledRaw: string | undefined,
): RedisMode {
  if (modeRaw !== undefined) {
    switch (modeRaw.trim().toLowerCase()) {
      case "enabled":
      case "on":
        return "enabled";
      case "disabled":
      case "off":
        return "disabled";
      case "auto":
        return "auto";
      default:
        return "auto";
    }
  }
  if (enabledRaw === "true") return "enabled";
  if (enabledRaw === "false") return "disabled";
  return "auto";
}

/** The subset of ioredis the health controller depends on (fakeable in tests). */
export interface RedisHealthClientLike {
  status: string;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  off?(event: string, cb: (...args: unknown[]) => void): unknown;
  connect(): Promise<unknown>;
}

export interface RedisHealthOptions {
  /** Re-probe cadence for unreachable Redis in auto mode. */
  probeIntervalMs: number;
  /** Whether failed connections should be re-probed on a timer. */
  autoRecheck: boolean;
}

export interface RedisHealth {
  isHealthy(): boolean;
  dispose(): void;
}

/**
 * Tracks whether the Redis client is usable and, in auto mode, re-checks an
 * unreachable client on a fixed cadence.
 *
 * - `ready` → healthy (also cancels any pending re-probe).
 * - `close`/`error` → unhealthy.
 * - `end` (ioredis stopped reconnecting) → unhealthy and, when `autoRecheck`,
 *   schedules a re-probe that calls `client.connect()` after `probeIntervalMs`.
 *
 * While unhealthy, callers bypass Redis entirely (no per-request timeouts).
 */
export function createRedisHealth(
  client: RedisHealthClientLike,
  options: RedisHealthOptions,
): RedisHealth {
  const { probeIntervalMs, autoRecheck } = options;
  let healthy = false;
  let probing = false;
  let timer: NodeJS.Timeout | undefined;

  const meter = metrics.getMeter("train-tracker-api");
  const redisUp = meter.createObservableGauge("redis.up", {
    description: "1 when the shared Redis client is reachable, else 0.",
    unit: "1",
  });
  redisUp.addCallback((result) => result.observe(healthy ? 1 : 0));

  /** Applies a health change, logging only on transition to avoid spam. */
  const setHealthy = (next: boolean): void => {
    if (healthy === next) return;
    healthy = next;
    if (next) {
      logger.info("Redis is available");
    } else {
      logger.warn("Redis is unavailable; bypassing cache");
    }
  };

  const clearProbe = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const scheduleProbe = (): void => {
    if (!autoRecheck || probing || timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      void probe();
    }, probeIntervalMs);
    timer.unref?.();
  };

  const probe = async (): Promise<void> => {
    probing = true;
    try {
      if (client.status === "ready") {
        setHealthy(true);
      } else if (client.status === "connecting" || client.status === "connect") {
        // An attempt is already in flight; `ready`/`end` events settle state.
      } else {
        await client.connect();
        setHealthy(true);
      }
    } catch {
      setHealthy(false);
    } finally {
      probing = false;
    }
    if (!healthy) {
      scheduleProbe();
    }
  };

  const markHealthy = (): void => {
    setHealthy(true);
    clearProbe();
  };

  const onClose = (): void => {
    setHealthy(false);
  };

  const onError = (): void => {
    setHealthy(false);
  };

  const onEnd = (): void => {
    setHealthy(false);
    scheduleProbe();
  };

  client.on("ready", markHealthy);
  client.on("close", onClose);
  client.on("error", onError);
  client.on("end", onEnd);

  return {
    isHealthy: () => healthy,
    dispose: () => {
      clearProbe();
      client.off?.("ready", markHealthy);
      client.off?.("close", onClose);
      client.off?.("error", onError);
      client.off?.("end", onEnd);
    },
  };
}

/**
 * Creates a single shared ioredis client wrapped in a {@link RedisStore}.
 *
 * Returns `undefined` when Redis is disabled (see {@link parseRedisConfig}).
 * In auto mode a failed connection stops the reconnect loop and the health
 * controller re-probes every `probeIntervalMs` (15 minutes by default),
 * resuming use as soon as Redis is reachable again.
 */
export function createRedisStore(url?: string): RedisStore | undefined {
  const config = parseRedisConfig(process.env);
  if (config.mode === "disabled") {
    return undefined;
  }

  const redisUrl = url ?? config.url;
  const autoRecheck = config.mode === "auto";

  const client = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
    connectTimeout: 10_000,
    commandTimeout: config.commandTimeoutMs,
    keepAlive: 30_000,
    retryStrategy: autoRecheck
      ? (times) => (times <= 1 ? 1_000 : null)
      : (times) => Math.min(times * 250, 5_000),
  });

  const health = createRedisHealth(client, {
    probeIntervalMs: config.probeIntervalMs,
    autoRecheck,
  });

  const store: RedisStore = {
    isAvailable: () => health.isHealthy(),
    // getBuffer preserves binary values (e.g. gzip-compressed payloads) that
    // `get` would lossily UTF-8-decode into mangled strings.
    get: (key) => client.getBuffer(key) as Promise<Buffer | null>,
    set: (key, value, ttlSeconds) => client.set(key, value, "EX", ttlSeconds),
    close: () => {
      health.dispose();
      return client.quit();
    },
  };

  createdStores.push(store);
  return store;
}

/** Disconnects every store created by {@link createRedisStore}. */
export async function shutdownRedis(): Promise<void> {
  await Promise.allSettled(
    createdStores.splice(0).map((store) => store.close?.()),
  );
}

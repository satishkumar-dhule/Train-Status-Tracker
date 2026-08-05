import {
  metrics,
  ValueType,
  type Counter,
  type Histogram,
} from "@opentelemetry/api";
import { performance } from "node:perf_hooks";
import { gzipSync, gunzipSync } from "node:zlib";
import type { RedisStore } from "./redis-client";

/**
 * Outcome of a cache lookup. `negative` marks a cached "not found" result
 * (see {@link RedisTtlCache.setNegative}).
 */
export type CacheResult<T> =
  | { status: "hit"; value: T }
  | { status: "negative" }
  | { status: "miss" };

export interface RedisCacheOptions<T> {
  /** Base TTL applied to positive values, in milliseconds. */
  ttlMs: number;
  /** TTL for cached "not found" markers, in milliseconds. */
  negativeTtlMs: number;
  /**
   * Fraction of `ttlMs` to randomize each stored TTL around so keys across
   * instances expire at staggered times instead of in a synchronized stampede.
   * 0 disables jitter, 0.1 means `ttl * [0.9, 1.1]`.
   */
  jitter?: number;
  /** Namespace prefix for every key. */
  keyPrefix?: string;
  /** gzip-compress serialized values to save Redis memory. */
  compress?: boolean;
  /** Injectable RNG for deterministic jitter in tests. */
  random?: () => number;
  /** Invoked (without throwing) when a Redis operation fails and is ignored. */
  onError?: (err: unknown, operation: string, key: string) => void;
  /** Returns the serialized string form of a cached value. */
  serialize?: (value: T) => string;
  /** Parses a stored value back into a cached value. Receives the raw value. */
  deserialize?: (raw: string | Buffer) => T;
}

const NOT_FOUND_MARKER = "tt:not-found";

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

const getMeter = () => metrics.getMeter("train-tracker-api");

let redisRequestsCounter: Counter | undefined;
const getRedisRequestsCounter = (): Counter =>
  (redisRequestsCounter ??= getMeter().createCounter(
    "trains.status.redis.requests",
    {
      description: "Redis cache operations by operation and outcome",
    },
  ));

let redisDurationHistogram: Histogram | undefined;
const getRedisDurationHistogram = (): Histogram =>
  (redisDurationHistogram ??= getMeter().createHistogram(
    "trains.status.redis.duration",
    {
      description: "Redis cache operation latency",
      unit: "s",
      valueType: ValueType.DOUBLE,
    },
  ));

/**
 * TTL-jittered, fail-open Redis-backed cache. Every value and "not found"
 * marker carries an expiry, so memory is self-bounding and LRU eviction (the
 * recommended Render Key Value policy for caches) is always safe.
 *
 * Fail-open means a down, slow, or eviction-denied Redis never fails a
 * request: `get` falls through to a miss and `set`/`setNegative` are no-ops
 * (errors are counted and reported via `onError`). Out-of-band TTL expiry is
 * handled natively by Redis; callers must also guard their own single-flight
 * for in-process stampede protection.
 */
export function createRedisTtlCache<T>(
  store: RedisStore,
  options: RedisCacheOptions<T>,
): RedisTtlCache<T> {
  const {
    ttlMs,
    negativeTtlMs,
    jitter = 0,
    keyPrefix = "tt",
    compress = false,
    random = Math.random,
  } = options;

  if (ttlMs <= 0) throw new Error("ttlMs must be positive");
  if (negativeTtlMs <= 0) throw new Error("negativeTtlMs must be positive");

  const serialize = options.serialize ?? defaultSerialize<T>();
  const deserialize = options.deserialize ?? defaultDeserialize<T>();
  const toBuffer = (json: string): string | Buffer =>
    compress ? gzipSync(Buffer.from(json, "utf8")) : json;

  const keyOf = (key: string): string => `${keyPrefix}:${key}`;

  function jitteredTtlMs(baseTtlMs: number): number {
    if (jitter <= 0 || jitter >= 1) return baseTtlMs;
    const factor = 1 - jitter + random() * (2 * jitter);
    return Math.max(1, Math.round(baseTtlMs * factor));
  }

  const toSeconds = (ms: number): number =>
    Math.max(1, Math.round(ms / 1000));

  function record(operation: string, outcome: string, startedAt: number): void {
    getRedisRequestsCounter().add(1, { operation, outcome });
    getRedisDurationHistogram().record(
      (performance.now() - startedAt) / 1000,
      { operation, outcome },
    );
  }

  async function safeGet(key: string): Promise<string | Buffer | null> {
    const startedAt = performance.now();
    try {
      if (!store.isAvailable()) {
        record("get", "unavailable", startedAt);
        return null;
      }
      const raw = await store.get(key);
      if (raw === null) {
        record("get", "miss", startedAt);
      } else {
        record("get", "hit", startedAt);
      }
      return raw;
    } catch (err) {
      record("get", "error", startedAt);
      options.onError?.(err, "get", key);
      return null;
    }
  }

  async function safeSet(
    operation: "set" | "set_negative",
    key: string,
    value: string | Buffer,
    ttlSeconds: number,
  ): Promise<void> {
    const startedAt = performance.now();
    try {
      if (!store.isAvailable()) {
        record(operation, "unavailable", startedAt);
        return;
      }
      await store.set(key, value, ttlSeconds);
      record(operation, "ok", startedAt);
    } catch (err) {
      record(operation, "error", startedAt);
      options.onError?.(err, operation, key);
    }
  }

  return {
    isAvailable: () => store.isAvailable(),

    async get(key: string): Promise<CacheResult<T>> {
      const raw = await safeGet(keyOf(key));
      if (raw === null) return { status: "miss" };

      const rawText = Buffer.isBuffer(raw) ? raw.toString("utf8") : raw;
      if (rawText === NOT_FOUND_MARKER) {
        return { status: "negative" };
      }

      try {
        return { status: "hit", value: deserialize(raw) };
      } catch (err) {
        record("deserialize", "error", performance.now());
        options.onError?.(err, "deserialize", key);
        return { status: "miss" };
      }
    },

    async set(key: string, value: T, ttlMsOverride?: number): Promise<void> {
      const json = serialize(value);
      const raw = toBuffer(json);
      await safeSet(
        "set",
        keyOf(key),
        raw,
        toSeconds(jitteredTtlMs(ttlMsOverride ?? ttlMs)),
      );
    },

    async setNegative(key: string, ttlMsOverride?: number): Promise<void> {
      await safeSet(
        "set_negative",
        keyOf(key),
        NOT_FOUND_MARKER,
        toSeconds(jitteredTtlMs(ttlMsOverride ?? negativeTtlMs)),
      );
    },
  };
}

function defaultSerialize<T>(): (value: T) => string {
  return (value) => JSON.stringify(value);
}

function defaultDeserialize<T>(): (raw: string | Buffer) => T {
  return (raw) => {
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const compressed =
      buf.length >= 2 && buf[0] === GZIP_MAGIC[0] && buf[1] === GZIP_MAGIC[1];
    const text = compressed
      ? gunzipSync(buf).toString("utf8")
      : buf.toString("utf8");
    return JSON.parse(text) as T;
  };
}

export interface RedisTtlCache<T> {
  isAvailable(): boolean;
  get(key: string): Promise<CacheResult<T>>;
  set(key: string, value: T, ttlMsOverride?: number): Promise<void>;
  setNegative(key: string, ttlMsOverride?: number): Promise<void>;
}

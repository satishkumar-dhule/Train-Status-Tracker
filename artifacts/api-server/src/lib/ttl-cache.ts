import {
  metrics,
  type Counter,
} from "@opentelemetry/api";

export interface TtlCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  has(key: string): boolean;
  delete(key: string): boolean;
  /** Returns the cached value, or fetches it once via `producer` (single-flight) and caches it. */
  getOrSet(key: string, producer: () => Promise<T>): Promise<T>;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const getMeter = () => metrics.getMeter("train-tracker-api");

/** Default entry cap guarding against unbounded key spray. */
const DEFAULT_MAX_SIZE = 10_000;

let cacheHitsCounter: Counter | undefined;
const getCacheHitsCounter = (): Counter =>
  (cacheHitsCounter ??= getMeter().createCounter("trains.status.cache.hits", {
    description: "Train status cache hits",
  }));

let cacheMissesCounter: Counter | undefined;
const getCacheMissesCounter = (): Counter =>
  (cacheMissesCounter ??= getMeter().createCounter(
    "trains.status.cache.misses",
    {
      description: "Train status cache misses",
    },
  ));

let cacheEvictionsCounter: Counter | undefined;
const getCacheEvictionsCounter = (): Counter =>
  (cacheEvictionsCounter ??= getMeter().createCounter(
    "trains.status.cache.evictions",
    {
      description: "Entries dropped from the L1 TTL cache (expiry or cap)",
    },
  ));

let singleFlightCounter: Counter | undefined;
const getSingleFlightCounter = (): Counter =>
  (singleFlightCounter ??= getMeter().createCounter(
    "trains.status.cache.single_flight",
    {
      description:
        "Times a concurrent caller shared an in-flight cache producer",
    },
  ));

/**
 * Zero-dependency in-memory TTL cache. Entries expire lazily — `get`/`has`
 * drop stale entries instead of returning them (fail-closed). `now` is
 * injectable for tests. Capacity is bounded by `maxSize`: when exceeded,
 * expired entries are pruned first and then the oldest-inserted live entries
 * are evicted (Map insertion order), so an attacker spraying unique keys
 * cannot grow the cache without bound.
 *
 * `getOrSet` emits OpenTelemetry metrics (scope "train-tracker-api"): a
 * `trains.status.cache.hits` increment when a cached value is served and a
 * `trains.status.cache.misses` increment when the producer is invoked.
 */
export function createTtlCache<T>(
  ttlMs: number,
  now: () => number = Date.now,
  maxSize: number = DEFAULT_MAX_SIZE,
): TtlCache<T> {
  if (ttlMs <= 0) throw new Error("ttlMs must be positive");
  if (!Number.isFinite(maxSize) || maxSize <= 0) {
    throw new Error("maxSize must be a positive finite number");
  }
  const store = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, Promise<T>>();

  // Reports the current L1 size so cache growth/eviction pressure is visible.
  const cacheSizeGauge = metrics
    .getMeter("train-tracker-api")
    .createObservableGauge("trains.status.cache.size", {
      description: "Current number of entries in the L1 TTL cache",
      unit: "{entry}",
    });
  cacheSizeGauge.addCallback((result) => result.observe(store.size));

  function put(key: string, value: T, expiresAt: number): void {
    store.set(key, { value, expiresAt });
    if (store.size <= maxSize) return;

    const t = now();
    let dropped = 0;
    for (const [entryKey, entry] of store) {
      if (entry.expiresAt <= t) {
        store.delete(entryKey);
        dropped += 1;
      }
    }
    while (store.size > maxSize) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
      dropped += 1;
    }
    if (dropped > 0) {
      getCacheEvictionsCounter().add(dropped);
    }
  }

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      put(key, value, now() + ttlMs);
    },
    has(key: string): boolean {
      return this.get(key) !== undefined;
    },
    delete(key: string): boolean {
      const entry = store.get(key);
      if (!entry) return false;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return false;
      }
      store.delete(key);
      return true;
    },
    /**
     * Fetches the value for `key` once, sharing the in-flight promise with
     * concurrent callers. Failures are never cached, so the next call retries.
     */
    getOrSet(key: string, producer: () => Promise<T>): Promise<T> {
      const cached = this.get(key);
      if (cached !== undefined) {
        getCacheHitsCounter().add(1);
        return Promise.resolve(cached);
      }

      const pending = inFlight.get(key);
      if (pending) {
        getSingleFlightCounter().add(1);
        return pending;
      }

      getCacheMissesCounter().add(1);

      const startedAt = now();
      const promise = producer().then(
        (value) => {
          put(key, value, startedAt + ttlMs);
          inFlight.delete(key);
          return value;
        },
        (err: unknown) => {
          inFlight.delete(key);
          throw err;
        },
      );
      inFlight.set(key, promise);
      return promise;
    },
  };
}

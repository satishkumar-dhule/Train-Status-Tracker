import { metrics, type Counter } from "@opentelemetry/api";

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

/**
 * Zero-dependency in-memory TTL cache. Entries expire lazily — `get`/`has`
 * drop stale entries instead of returning them (fail-closed). `now` is
 * injectable for tests.
 *
 * `getOrSet` emits OpenTelemetry metrics (scope "train-tracker-api"): a
 * `trains.status.cache.hits` increment when a cached value is served and a
 * `trains.status.cache.misses` increment when the producer is invoked.
 */
export function createTtlCache<T>(
  ttlMs: number,
  now: () => number = Date.now,
): TtlCache<T> {
  if (ttlMs <= 0) throw new Error("ttlMs must be positive");
  const store = new Map<string, CacheEntry<T>>();
  const inFlight = new Map<string, Promise<T>>();

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
      store.set(key, { value, expiresAt: now() + ttlMs });
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
      if (pending) return pending;

      getCacheMissesCounter().add(1);

      const startedAt = now();
      const promise = producer().then(
        (value) => {
          store.set(key, { value, expiresAt: startedAt + ttlMs });
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

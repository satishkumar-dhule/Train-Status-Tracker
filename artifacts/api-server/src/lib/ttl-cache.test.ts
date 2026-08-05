import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "./ttl-cache";

const TTL = 5 * 60 * 1000;

function makeNow() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createTtlCache", () => {
  it("returns the stored value within TTL", () => {
    const { now, advance } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    cache.set("22943:20260802", "payload");
    advance(TTL - 1);
    expect(cache.get("22943:20260802")).toBe("payload");
    expect(cache.has("22943:20260802")).toBe(true);
  });

  it("treats expired entries as missing", () => {
    const { now, advance } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    cache.set("22943:20260802", "payload");
    advance(TTL);
    expect(cache.get("22943:20260802")).toBeUndefined();
    expect(cache.has("22943:20260802")).toBe(false);
  });

  it("drops the expired entry on access", () => {
    const { now, advance } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    cache.set("k", "v");
    advance(TTL + 1);
    cache.get("k");
    advance(0);
    expect(cache.get("k")).toBeUndefined();
  });

  it("overwriting refreshes the expiry", () => {
    const { now, advance } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    cache.set("k", "v1");
    advance(TTL - 1000);
    cache.set("k", "v2");
    advance(TTL - 1);
    expect(cache.get("k")).toBe("v2");
  });

  it("isolates keys", () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    cache.set("22943:20260802", "a");
    cache.set("22944:20260802", "b");
    cache.set("22943:20260803", "c");
    expect(cache.get("22943:20260802")).toBe("a");
    expect(cache.get("22944:20260802")).toBe("b");
    expect(cache.get("22943:20260803")).toBe("c");
  });

  it("rejects non-positive TTL", () => {
    expect(() => createTtlCache(0)).toThrow();
    expect(() => createTtlCache(-1)).toThrow();
  });

  it("rejects a non-positive maxSize", () => {
    expect(() => createTtlCache(TTL, Date.now, 0)).toThrow();
    expect(() => createTtlCache(TTL, Date.now, Number.NaN)).toThrow();
  });

  it("evicts the oldest entry when over maxSize", () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now, 2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("prunes expired entries before evicting", () => {
    const { now, advance } = makeNow();
    const cache = createTtlCache<string>(TTL, now, 2);
    cache.set("a", "1");
    advance(TTL + 1);
    cache.set("b", "2");
    cache.set("c", "3");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("overwriting an existing key does not consume extra capacity", () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now, 2);
    cache.set("a", "1");
    cache.set("a", "2");
    cache.set("b", "3");
    expect(cache.get("a")).toBe("2");
    expect(cache.get("b")).toBe("3");
  });

  it("getOrSet evicts the oldest entry when over maxSize", async () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now, 2);
    cache.set("a", "1");
    cache.set("b", "2");
    await cache.getOrSet("c", async () => "3");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
  });

  it("delete removes a live entry", () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    cache.set("k", "v");
    expect(cache.delete("k")).toBe(true);
    expect(cache.get("k")).toBeUndefined();
  });

  it("delete returns false for missing and expired keys", () => {
    const { now, advance } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    expect(cache.delete("missing")).toBe(false);
    cache.set("k", "v");
    advance(TTL + 1);
    expect(cache.delete("k")).toBe(false);
    expect(cache.get("k")).toBeUndefined();
  });

  it("getOrSet returns a cached value without re-running the producer", async () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    const producer = vi.fn(async () => "value");
    await expect(cache.getOrSet("k", producer)).resolves.toBe("value");
    await expect(cache.getOrSet("k", producer)).resolves.toBe("value");
    expect(producer).toHaveBeenCalledTimes(1);
  });

  it("getOrSet single-flights concurrent calls for the same key", async () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    const d = deferred<string>();
    const producer = vi.fn(() => d.promise);
    const p1 = cache.getOrSet("k", producer);
    const p2 = cache.getOrSet("k", producer);
    expect(producer).toHaveBeenCalledTimes(1);
    expect(p1).toBe(p2);
    d.resolve("payload");
    await expect(p1).resolves.toBe("payload");
    await expect(p2).resolves.toBe("payload");
    expect(cache.get("k")).toBe("payload");
  });

  it("getOrSet runs producers independently for different keys", async () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    const d1 = deferred<string>();
    const d2 = deferred<string>();
    const producer1 = vi.fn(() => d1.promise);
    const producer2 = vi.fn(() => d2.promise);
    const p1 = cache.getOrSet("a", producer1);
    const p2 = cache.getOrSet("b", producer2);
    expect(producer1).toHaveBeenCalledTimes(1);
    expect(producer2).toHaveBeenCalledTimes(1);
    d1.resolve("A");
    d2.resolve("B");
    await expect(p1).resolves.toBe("A");
    await expect(p2).resolves.toBe("B");
    expect(cache.get("a")).toBe("A");
    expect(cache.get("b")).toBe("B");
  });

  it("getOrSet rethrows producer failures and retries on the next call", async () => {
    const { now } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    const producer = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream down"))
      .mockResolvedValueOnce("recovered");
    await expect(cache.getOrSet("k", producer)).rejects.toThrow("upstream down");
    expect(cache.get("k")).toBeUndefined();
    await expect(cache.getOrSet("k", producer)).resolves.toBe("recovered");
    expect(producer).toHaveBeenCalledTimes(2);
  });

  it("getOrSet ignores an expired cached value and re-fetches", async () => {
    const { now, advance } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    cache.set("k", "stale");
    advance(TTL);
    const producer = vi.fn(async () => "fresh");
    await expect(cache.getOrSet("k", producer)).resolves.toBe("fresh");
    expect(producer).toHaveBeenCalledTimes(1);
    expect(cache.get("k")).toBe("fresh");
  });

  it("getOrSet does not store a value that expires before it completes", async () => {
    const { now, advance } = makeNow();
    const cache = createTtlCache<string>(TTL, now);
    const d = deferred<string>();
    const producer = vi.fn(() => d.promise);
    const p = cache.getOrSet("k", producer);
    advance(TTL + 1);
    d.resolve("late");
    await expect(p).resolves.toBe("late");
    expect(cache.get("k")).toBeUndefined();
  });
});

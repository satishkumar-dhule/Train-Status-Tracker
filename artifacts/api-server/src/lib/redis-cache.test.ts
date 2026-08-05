import { describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import { createRedisTtlCache, type RedisTtlCache } from "./redis-cache";
import type { RedisStore } from "./redis-client";

class FakeStore implements RedisStore {
  available = true;
  data = new Map<
    string,
    { value: string | Buffer; ttlSeconds: number }
  >();
  getCalls: string[] = [];
  setCalls: Array<{ key: string; value: string | Buffer; ttlSeconds: number }> =
    [];
  getError: Error | undefined;
  setError: Error | undefined;

  isAvailable(): boolean {
    return this.available;
  }

  async get(key: string): Promise<string | Buffer | null> {
    this.getCalls.push(key);
    if (this.getError) throw this.getError;
    return this.data.get(key)?.value ?? null;
  }

  async set(
    key: string,
    value: string | Buffer,
    ttlSeconds: number,
  ): Promise<unknown> {
    this.setCalls.push({ key, value, ttlSeconds });
    if (this.setError) throw this.setError;
    this.data.set(key, { value, ttlSeconds });
    return "OK";
  }
}

const PREFIX = "tt:status:v1";
const KEY = "22943:20260802";
const TTL_MS = 5 * 60 * 1000;

function makeCache(
  overrides: Partial<Parameters<typeof createRedisTtlCache<string>>[1]> = {},
  store: FakeStore = new FakeStore(),
): { cache: RedisTtlCache<string>; store: FakeStore } {
  const cache = createRedisTtlCache<string>(store, {
    ttlMs: TTL_MS,
    negativeTtlMs: 60_000,
    jitter: 0,
    keyPrefix: PREFIX,
    compress: false,
    random: () => 0.5,
    ...overrides,
  });
  return { cache, store };
}

describe("createRedisTtlCache", () => {
  it("returns a cached value as a hit", async () => {
    const { cache, store } = makeCache();
    await cache.set(KEY, "payload");
    await expect(cache.get(KEY)).resolves.toEqual({
      status: "hit",
      value: "payload",
    });
    expect(store.getCalls[0]).toBe(`${PREFIX}:${KEY}`);
  });

  it("reports a miss for an unknown key", async () => {
    const { cache } = makeCache();
    await expect(cache.get("missing")).resolves.toEqual({ status: "miss" });
  });

  it("overwriting a key refreshes the stored value", async () => {
    const { cache } = makeCache();
    await cache.set(KEY, "v1");
    await cache.set(KEY, "v2");
    await expect(cache.get(KEY)).resolves.toEqual({
      status: "hit",
      value: "v2",
    });
  });

  it("round-trips gzip-compressed values", async () => {
    const { cache, store } = makeCache({ compress: true });
    const payload = { stations: Array.from({ length: 50 }, () => "x") };
    await cache.set(KEY, JSON.stringify(payload));

    const stored = store.data.get(`${PREFIX}:${KEY}`)!.value;
    expect(Buffer.isBuffer(stored)).toBe(true);
    const buf = stored as Buffer;
    expect(buf[0]).toBe(0x1f);
    expect(buf[1]).toBe(0x8b);

    await expect(cache.get(KEY)).resolves.toEqual({
      status: "hit",
      value: JSON.stringify(payload),
    });
  });

  it("stores the negative marker uncompressed and reports negative", async () => {
    const { cache, store } = makeCache({ compress: true });
    await cache.setNegative(KEY);
    expect(store.data.get(`${PREFIX}:${KEY}`)!.value).toBe("tt:not-found");
    await expect(cache.get(KEY)).resolves.toEqual({ status: "negative" });
  });

  it("reports negative when the store returns the marker as a Buffer", async () => {
    const { cache, store } = makeCache({ compress: true });
    store.data.set(`${PREFIX}:${KEY}`, {
      value: Buffer.from("tt:not-found", "utf8"),
      ttlSeconds: 60,
    });
    await expect(cache.get(KEY)).resolves.toEqual({ status: "negative" });
  });

  it("namespaces keys with the configured prefix", async () => {
    const { cache, store } = makeCache({ keyPrefix: "ns" });
    await cache.set("k", "v");
    expect(store.setCalls[0].key).toBe("ns:k");
    expect(store.getCalls).toHaveLength(0);
  });

  it("jitters the stored TTL around the base using the injected rng", async () => {
    const { cache, store } = makeCache({
      jitter: 0.1,
      random: () => 0,
    });
    await cache.set(KEY, "v");
    expect(store.setCalls[0].ttlSeconds).toBe(
      Math.round((TTL_MS * 0.9) / 1000),
    );

    const { cache: cacheHigh, store: storeHigh } = makeCache({
      jitter: 0.1,
      random: () => 1,
    });
    await cacheHigh.set(KEY, "v");
    expect(storeHigh.setCalls[0].ttlSeconds).toBe(
      Math.round((TTL_MS * 1.1) / 1000),
    );
  });

  it("keeps a fixed TTL when jitter is zero", async () => {
    const { cache, store } = makeCache({ jitter: 0 });
    await cache.set(KEY, "v");
    expect(store.setCalls[0].ttlSeconds).toBe(Math.round(TTL_MS / 1000));
  });

  it("honors a per-call TTL override", async () => {
    const { cache, store } = makeCache();
    await cache.set(KEY, "v", 30_000);
    expect(store.setCalls[0].ttlSeconds).toBe(30);

    const { cache: neg, store: negStore } = makeCache();
    await neg.setNegative(KEY, 5_000);
    expect(negStore.setCalls[0].ttlSeconds).toBe(5);
  });

  it("uses custom serialize/deserialize functions", async () => {
    const onError = vi.fn();
    const { cache, store } = makeCache({
      serialize: (value) => value.toUpperCase(),
      deserialize: (raw) =>
        (typeof raw === "string" ? raw : raw.toString("utf8")).toLowerCase(),
      onError,
    });
    await cache.set(KEY, "abc");
    expect(store.data.get(`${PREFIX}:${KEY}`)!.value).toBe("ABC");
    await expect(cache.get(KEY)).resolves.toEqual({
      status: "hit",
      value: "abc",
    });
  });

  it("fails open when the store throws on get", async () => {
    const onError = vi.fn();
    const store = new FakeStore();
    store.getError = new Error("redis down");
    const { cache } = makeCache({ onError }, store);

    await expect(cache.get(KEY)).resolves.toEqual({ status: "miss" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe("get");
  });

  it("fails open when the store throws on set", async () => {
    const onError = vi.fn();
    const store = new FakeStore();
    store.setError = new Error("oom");
    const { cache } = makeCache({ onError }, store);

    await expect(cache.set(KEY, "v")).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe("set");
  });

  it("fails open when setNegative hits an error", async () => {
    const onError = vi.fn();
    const store = new FakeStore();
    store.setError = new Error("oom");
    const { cache } = makeCache({ onError }, store);

    await expect(cache.setNegative(KEY)).resolves.toBeUndefined();
    expect(onError.mock.calls[0][1]).toBe("set_negative");
  });

  it("bypasses an unavailable store without calling it", async () => {
    const store = new FakeStore();
    store.available = false;
    const { cache } = makeCache({}, store);

    await expect(cache.get(KEY)).resolves.toEqual({ status: "miss" });
    await expect(cache.set(KEY, "v")).resolves.toBeUndefined();
    expect(store.getCalls).toHaveLength(0);
    expect(store.setCalls).toHaveLength(0);
  });

  it("treats undecodable values as a miss and reports the error", async () => {
    const onError = vi.fn();
    const store = new FakeStore();
    store.data.set(`${PREFIX}:${KEY}`, { value: "not-json{", ttlSeconds: 60 });
    const { cache } = makeCache({ onError }, store);

    await expect(cache.get(KEY)).resolves.toEqual({ status: "miss" });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe("deserialize");
  });

  it("rejects non-positive TTLs", () => {
    expect(() =>
      createRedisTtlCache<string>(new FakeStore(), {
        ttlMs: 0,
        negativeTtlMs: 1000,
      }),
    ).toThrow();
    expect(() =>
      createRedisTtlCache<string>(new FakeStore(), {
        ttlMs: 1000,
        negativeTtlMs: 0,
      }),
    ).toThrow();
  });

  it("round-trips a pre-compressed payload exactly like production stores", async () => {
    const store = new FakeStore();
    const payload = { train_number: "22943", stations: ["a", "b", "c"] };
    store.data.set(`${PREFIX}:${KEY}`, {
      value: gzipSync(Buffer.from(JSON.stringify(payload))),
      ttlSeconds: 300,
    });

    const { cache } = makeCache({ compress: true }, store);
    await expect(cache.get(KEY)).resolves.toEqual({
      status: "hit",
      value: payload,
    });
  });
});

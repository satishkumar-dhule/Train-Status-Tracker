import { describe, expect, it, vi } from "vitest";
import type { TrainEntry } from "./search";
import {
  buildTrainDataUrl,
  createTrainDataFetcher,
  parseTrainDataJs,
  TRAIN_DATA_DEFAULT_URL,
  TRAIN_DATA_DEFAULT_TTL_MS,
} from "./fetcher";

const SAMPLE_JS = `var arrTrainList = ["00111- BIRD-SGTY RAPID CARGO",
"12001- Bhopal Shatabdi Express",
"12002- New Delhi Shatabdi Express",
"22943- Indore Intercity SF Express",
"99999- MUMBAI-RAJDHANI EXPRESS"
];`;

const SAMPLE_TRAINS: TrainEntry[] = [
  { number: "00111", name: "BIRD-SGTY RAPID CARGO" },
  { number: "12001", name: "Bhopal Shatabdi Express" },
  { number: "12002", name: "New Delhi Shatabdi Express" },
  { number: "22943", name: "Indore Intercity SF Express" },
  { number: "99999", name: "MUMBAI-RAJDHANI EXPRESS" },
];

describe("parseTrainDataJs", () => {
  it("parses the NTES array into entries", () => {
    expect(parseTrainDataJs(SAMPLE_JS)).toEqual(SAMPLE_TRAINS);
  });

  it("splits on the first '- ' so hyphens inside names survive", () => {
    const trains = parseTrainDataJs(
      'var arrTrainList = ["00111- BIRD-SGTY RAPID CARGO"];',
    );
    expect(trains[0]).toEqual({
      number: "00111",
      name: "BIRD-SGTY RAPID CARGO",
    });
  });

  it("skips entries with malformed numbers or empty names", () => {
    const raw =
      'var arrTrainList = ["12001- Bhopal Shatabdi Express", "garbage", "no-dash", "1234- short", "54321- "];';
    expect(parseTrainDataJs(raw)).toEqual([
      { number: "12001", name: "Bhopal Shatabdi Express" },
    ]);
  });

  it("returns [] for garbage input", () => {
    expect(parseTrainDataJs("not javascript at all")).toEqual([]);
    expect(parseTrainDataJs("var arrTrainList = {}")).toEqual([]);
    expect(parseTrainDataJs("")).toEqual([]);
  });
});

describe("buildTrainDataUrl", () => {
  it("returns the base URL unchanged without a version", () => {
    expect(buildTrainDataUrl(TRAIN_DATA_DEFAULT_URL)).toBe(
      TRAIN_DATA_DEFAULT_URL,
    );
  });

  it("appends the v query param", () => {
    expect(buildTrainDataUrl(TRAIN_DATA_DEFAULT_URL, "202608051517")).toBe(
      `${TRAIN_DATA_DEFAULT_URL}?v=202608051517`,
    );
  });

  it("overrides an existing v param", () => {
    const withV = buildTrainDataUrl(TRAIN_DATA_DEFAULT_URL, "1");
    expect(buildTrainDataUrl(withV, "2")).toBe(`${TRAIN_DATA_DEFAULT_URL}?v=2`);
  });

  it("encodes a custom version value", () => {
    expect(buildTrainDataUrl(TRAIN_DATA_DEFAULT_URL, "a b&c")).toBe(
      `${TRAIN_DATA_DEFAULT_URL}?v=a+b%26c`,
    );
  });
});

describe("createTrainDataFetcher", () => {
  function jsResponse(raw: string): Response {
    return new Response(raw, {
      status: 200,
      headers: { "Content-Type": "application/javascript" },
    });
  }

  function makeNow() {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  }

  it("fetches, parses and caches within the TTL", async () => {
    const fetchFn = vi.fn(async () => jsResponse(SAMPLE_JS));
    const fetcher = createTrainDataFetcher({
      fetchFn,
      ttlMs: TRAIN_DATA_DEFAULT_TTL_MS,
    });

    const first = await fetcher.getTrains();
    const second = await fetcher.getTrains();

    expect(first).toEqual(SAMPLE_TRAINS);
    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the TTL expires", async () => {
    const { now, advance } = makeNow();
    const fetchFn = vi.fn(async () => jsResponse(SAMPLE_JS));
    const fetcher = createTrainDataFetcher({ fetchFn, now, ttlMs: 1000 });

    await fetcher.getTrains();
    advance(1001);
    await fetcher.getTrains();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("single-flights concurrent callers", async () => {
    const fetchFn = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      return jsResponse(SAMPLE_JS);
    });
    const fetcher = createTrainDataFetcher({ fetchFn });

    const [a, b] = await Promise.all([
      fetcher.getTrains(),
      fetcher.getTrains(),
    ]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("falls back to the bundled dataset on fetch failure", async () => {
    const onError = vi.fn();
    const fetchFn = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const fetcher = createTrainDataFetcher({ fetchFn, onError });

    const trains = await fetcher.getTrains();

    expect(trains.length).toBeGreaterThan(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(TypeError);
  });

  it("falls back when the upstream returns a non-200 response", async () => {
    const fetchFn = vi.fn(async () => new Response("boom", { status: 500 }));
    const fetcher = createTrainDataFetcher({ fetchFn });

    const trains = await fetcher.getTrains();
    expect(trains.length).toBeGreaterThan(0);
  });

  it("falls back when the payload is empty", async () => {
    const fetchFn = vi.fn(async () => jsResponse("var arrTrainList = [];"));
    const fallback: TrainEntry[] = [
      { number: "12001", name: "Bhopal Shatabdi Express" },
    ];
    const fetcher = createTrainDataFetcher({ fetchFn, fallback });

    expect(await fetcher.getTrains()).toEqual(fallback);
  });

  it("does not cache failures (retries on the next call)", async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValueOnce(jsResponse(SAMPLE_JS));
    const fetcher = createTrainDataFetcher({ fetchFn });

    const first = await fetcher.getTrains();
    const second = await fetcher.getTrains();

    expect(first).not.toEqual(SAMPLE_TRAINS);
    expect(second).toEqual(SAMPLE_TRAINS);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("uses a different cache key when the version changes", async () => {
    const fetchFn = vi.fn(async () => jsResponse(SAMPLE_JS));
    const a = createTrainDataFetcher({ fetchFn, version: "1" });
    const b = createTrainDataFetcher({ fetchFn, version: "2" });

    await a.getTrains();
    await b.getTrains();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(a.sourceUrl).toContain("v=1");
    expect(b.sourceUrl).toContain("v=2");
  });

  it("rejects a non-positive TTL", () => {
    expect(() => createTrainDataFetcher({ ttlMs: 0 })).toThrow();
  });

  it("rejects invalid hardening options", () => {
    expect(() => createTrainDataFetcher({ timeoutMs: 0 })).toThrow();
    expect(() => createTrainDataFetcher({ maxRedirects: -1 })).toThrow();
    expect(() => createTrainDataFetcher({ maxResponseBytes: 0 })).toThrow();
  });

  it("aborts the upstream fetch when it exceeds the timeout", async () => {
    const onError = vi.fn();
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason),
        );
      });
    });
    const fetcher = createTrainDataFetcher({ fetchFn, onError, timeoutMs: 20 });

    const trains = await fetcher.getTrains();

    expect(trains.length).toBeGreaterThan(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain("timed out");
  });

  it("follows a bounded number of redirects then succeeds", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (String(url).includes("enquiry.indianrail.gov.in")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://mirror.example/train_data.js?v=2" },
        });
      }
      return jsResponse(SAMPLE_JS);
    });
    const fetcher = createTrainDataFetcher({ fetchFn, maxRedirects: 3 });

    expect(await fetcher.getTrains()).toEqual(SAMPLE_TRAINS);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("falls back when redirects exceed the cap", async () => {
    const onError = vi.fn();
    const fetchFn = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://mirror.example/train_data.js" },
        }),
    );
    const fetcher = createTrainDataFetcher({
      fetchFn,
      onError,
      maxRedirects: 2,
    });

    const trains = await fetcher.getTrains();

    expect(trains.length).toBeGreaterThan(0);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain("redirect");
  });

  it("falls back when the response body exceeds the byte cap", async () => {
    const onError = vi.fn();
    const fetchFn = vi.fn(async () => new Response("x".repeat(4096)));
    const fetcher = createTrainDataFetcher({
      fetchFn,
      onError,
      maxResponseBytes: 1024,
    });

    const trains = await fetcher.getTrains();

    expect(trains.length).toBeGreaterThan(0);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain("exceeded");
  });

  it("search runs the fuzzy matcher against the fetched list", async () => {
    const fetchFn = vi.fn(async () => jsResponse(SAMPLE_JS));
    const fetcher = createTrainDataFetcher({ fetchFn });

    const byNumber = await fetcher.search("229");
    expect(byNumber[0]).toEqual({
      number: "22943",
      name: "Indore Intercity SF Express",
    });

    const byName = await fetcher.search("shatabdi");
    expect(byName).toContainEqual({
      number: "12001",
      name: "Bhopal Shatabdi Express",
    });
  });

  it("exposes the effective source URL", () => {
    const fetcher = createTrainDataFetcher({ version: "202608051517" });
    expect(fetcher.sourceUrl).toBe(`${TRAIN_DATA_DEFAULT_URL}?v=202608051517`);
  });
});

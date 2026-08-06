import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import {
  metrics,
  type Counter,
  type Histogram,
  type Meter,
} from "@opentelemetry/api";
import {
  createRateLimiter,
  createRateLimitMiddleware,
  type RateLimiter,
} from "./rate-limit";

const counterAdds: Array<{
  name: string;
  value: number;
  attributes: Record<string, string | number>;
}> = [];
metrics.setGlobalMeterProvider({
  getMeter: (): Meter =>
    ({
      createCounter: (name: string): Counter => ({
        add: (value: number, attributes?: Record<string, string | number>) => {
          counterAdds.push({ name, value, attributes: attributes ?? {} });
        },
      }),
      createHistogram: (name: string): Histogram => ({
        record: (
          _value: number,
          _attributes?: Record<string, string | number>,
        ) => {},
      }),
    }) as Meter,
});

afterEach(() => {
  counterAdds.length = 0;
});

function makeNow() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("createRateLimiter", () => {
  it("allows requests up to the limit within a window", () => {
    const { now } = makeNow();
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now });
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("ip").allowed).toBe(true);
    }
  });

  it("blocks requests beyond the limit", () => {
    const { now } = makeNow();
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, now });
    for (let i = 0; i < 3; i++) limiter.check("ip");
    const blocked = limiter.check("ip");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets the window after it elapses", () => {
    const { now, advance } = makeNow();
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now });
    limiter.check("ip");
    limiter.check("ip");
    expect(limiter.check("ip").allowed).toBe(false);
    advance(60_000);
    expect(limiter.check("ip").allowed).toBe(true);
  });

  it("tracks keys independently", () => {
    const { now } = makeNow();
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, now });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    expect(limiter.check("b").allowed).toBe(false);
  });

  it("rejects non-finite limits and windows", () => {
    expect(() =>
      createRateLimiter({ limit: Number.NaN, windowMs: 1000 }),
    ).toThrow();
    expect(() =>
      createRateLimiter({ limit: 1, windowMs: Number.POSITIVE_INFINITY }),
    ).toThrow();
  });

  it("binds the number of tracked keys by evicting the oldest entry", () => {
    const { now } = makeNow();
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now,
      maxKeys: 2,
    });
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("c").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(false);
    expect(limiter.check("a").allowed).toBe(true);
  });
});

describe("createRateLimitMiddleware", () => {
  interface FakeResponse {
    statusCode: number;
    headers: Record<string, string>;
    body?: unknown;
    status(code: number): FakeResponse;
    setHeader(name: string, value: string): FakeResponse;
    json(body: unknown): FakeResponse;
  }

  function fakeResponse(): FakeResponse {
    const res: FakeResponse = {
      statusCode: 200,
      headers: {},
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        this.headers[name.toLowerCase()] = value;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
    return res;
  }

  it("passes through when the limiter allows the request", () => {
    const limiter: RateLimiter = {
      check: () => ({ allowed: true, retryAfterMs: 0 }),
    };
    const middleware = createRateLimitMiddleware(limiter, () => "ip");
    const req = {} as Request;
    const res = fakeResponse();
    const next = vi.fn();
    middleware(req, res as unknown as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });

  it("returns 429 with Retry-After when the limiter blocks the request", () => {
    const limiter: RateLimiter = {
      check: () => ({ allowed: false, retryAfterMs: 30_000 }),
    };
    const middleware = createRateLimitMiddleware(limiter, () => "ip");
    const req = {} as Request;
    const res = fakeResponse();
    const next = vi.fn();
    middleware(req, res as unknown as Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(429);
    expect(res.headers["retry-after"]).toBe("30");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      error: "Too many requests",
    });
  });

  it("keys by the provided extractor", () => {
    const keys: string[] = [];
    const limiter: RateLimiter = {
      check: (key) => {
        keys.push(key);
        return { allowed: true, retryAfterMs: 0 };
      },
    };
    const middleware = createRateLimitMiddleware(
      limiter,
      (req) => req.ip ?? "unknown",
    );
    const req = { ip: "10.0.0.7" } as Request;
    middleware(req, fakeResponse() as unknown as Response, vi.fn());
    expect(keys).toEqual(["10.0.0.7"]);
  });

  it("records a denied decision metric when blocking a request", () => {
    const limiter: RateLimiter = {
      check: () => ({ allowed: false, retryAfterMs: 30_000 }),
    };
    const middleware = createRateLimitMiddleware(limiter, () => "ip");
    middleware(
      {} as Request,
      fakeResponse() as unknown as Response,
      vi.fn(),
    );

    const recorded = counterAdds.find(
      (c) => c.name === "app.rate_limit.decisions",
    );
    expect(recorded).toEqual({
      name: "app.rate_limit.decisions",
      value: 1,
      attributes: { result: "denied" },
    });
  });

  it("tags the decision metric with the route label", () => {
    const limiter: RateLimiter = {
      check: () => ({ allowed: false, retryAfterMs: 30_000 }),
    };
    const middleware = createRateLimitMiddleware(
      limiter,
      () => "ip",
      "trains.runs",
    );
    middleware(
      {} as Request,
      fakeResponse() as unknown as Response,
      vi.fn(),
    );

    const recorded = counterAdds.find(
      (c) => c.name === "app.rate_limit.decisions",
    );
    expect(recorded?.attributes).toEqual({
      result: "denied",
      route: "trains.runs",
    });
  });
});

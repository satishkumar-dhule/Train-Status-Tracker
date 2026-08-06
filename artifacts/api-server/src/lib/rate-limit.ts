import type { Request, RequestHandler, Response } from "express";
import { metrics, type Counter } from "@opentelemetry/api";

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until a blocked key can retry. */
  retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string): RateLimitResult;
}

export interface RateLimitOptions {
  /** Max requests per `windowMs` per key. Must be a positive finite number. */
  limit: number;
  /** Window length in milliseconds. Must be a positive finite number. */
  windowMs: number;
  /** Injectable clock for tests. */
  now?: () => number;
  /** Upper bound on tracked keys; oldest entries are evicted beyond it. */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

const getMeter = () => metrics.getMeter("train-tracker-api");
let decisionsCounter: Counter | undefined;
/** Counts rate-limit decisions; the client key is deliberately NOT an
 * attribute (it is high-cardinality user input), only the decision is. */
function getDecisionsCounter(): Counter {
  return (decisionsCounter ??= getMeter().createCounter(
    "app.rate_limit.decisions",
    {
      description: "Rate-limit decisions by outcome.",
      unit: "{decision}",
    },
  ));
}

/**
 * Zero-dependency fixed-window rate limiter keyed by an arbitrary string
 * (e.g. a client IP). State is in-process only, so limits apply per instance.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { limit, windowMs, maxKeys = DEFAULT_MAX_KEYS } = options;
  const now = options.now ?? Date.now;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error("limit must be a positive finite number");
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("windowMs must be a positive finite number");
  }

  const windows = new Map<string, { start: number; count: number }>();

  return {
    check(key: string): RateLimitResult {
      const t = now();
      let entry = windows.get(key);
      if (!entry || entry.start <= t - windowMs) {
        entry = { start: t, count: 0 };
        windows.set(key, entry);
      }
      entry.count += 1;
      if (entry.count > limit) {
        return {
          allowed: false,
          retryAfterMs: Math.max(0, entry.start + windowMs - t),
        };
      }

      if (windows.size > maxKeys) {
        for (const [candidate, stale] of windows) {
          if (stale.start <= t - windowMs) {
            windows.delete(candidate);
          }
        }
        while (windows.size > maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest === undefined) break;
          windows.delete(oldest);
        }
      }
      return { allowed: true, retryAfterMs: 0 };
    },
  };
}

/**
 * Express middleware enforcing `limiter` per request. Blocked requests receive
 * `429 Too Many Requests` with a `Retry-After` header; the response is marked
 * non-cacheable. Each decision increments a metric and blocked requests are
 * logged with their retry-after window so 429s are traceable.
 */
export function createRateLimitMiddleware(
  limiter: RateLimiter,
  keyFor: (req: Request) => string,
  routeLabel?: string,
): RequestHandler {
  return (req: Request, res: Response, next) => {
    const result = limiter.check(keyFor(req));
    if (!result.allowed) {
      const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
      getDecisionsCounter().add(1, {
        result: "denied",
        ...(routeLabel === undefined ? {} : { route: routeLabel }),
      });
      req.log?.warn(
        { retryAfterMs: result.retryAfterMs },
        "Rate limit exceeded",
      );
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({ error: "Too many requests" });
      return;
    }
    getDecisionsCounter().add(1, {
      result: "allowed",
      ...(routeLabel === undefined ? {} : { route: routeLabel }),
    });
    next();
  };
}

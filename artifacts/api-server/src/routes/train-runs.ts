import { Router, type IRouter } from "express";
import {
  GetTrainRunsQueryParams,
  GetTrainRunsResponse,
} from "@workspace/api-zod";
import {
  metrics,
  trace,
  SpanStatusCode,
  type Counter,
} from "@opentelemetry/api";
import { createTtlCache } from "../lib/ttl-cache";
import { logger } from "../lib/logger";
import { createRedisStore } from "../lib/redis-client";
import { createRedisTtlCache } from "../lib/redis-cache";
import {
  createRateLimiter,
  createRateLimitMiddleware,
} from "../lib/rate-limit";
import { envPositiveNumber } from "../lib/env";
import { zodErrorMessage } from "../lib/zod-errors";
import { sanitizeException } from "../lib/trace-attributes";
import {
  computeRunDates,
  probeTrainRuns,
  type RunWeekdaysResult,
} from "../lib/train-runs";

/** Routes for train run-date discovery. */
const router: IRouter = Router();

/** How long an inferred running-weekday pattern is trusted before re-probing. */
const RUNS_CACHE_TTL_MS = envPositiveNumber(
  process.env,
  "RUNS_CACHE_TTL_MS",
  6 * 60 * 60 * 1000,
);

/** Local hot-path TTL; shorter than the shared (Redis) TTL so L1 re-promotes from L2. */
const RUNS_CACHE_L1_TTL_MS = envPositiveNumber(
  process.env,
  "RUNS_CACHE_L1_TTL_MS",
  5 * 60 * 1000,
);

/** TTL randomization (±fraction) to stagger cross-instance expiry. */
const RUNS_CACHE_TTL_JITTER = envPositiveNumber(
  process.env,
  "RUNS_CACHE_TTL_JITTER",
  0.1,
);

const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? "tt:runs:v1";

const REDIS_COMPRESS = process.env.REDIS_GZIP !== "false";

/** Max /trains/runs requests per client IP per window. */
const RUNS_RATE_LIMIT_PER_MIN = envPositiveNumber(
  process.env,
  "RUNS_RATE_LIMIT_PER_MIN",
  10,
);

/**
 * Per-IP rate limit for the run-discovery endpoint: a single request fans out
 * into up to 21 upstream probes, so the endpoint is limited to a strict,
 * per-client budget in-process (distributed instances each apply their own).
 */
const runsRateLimiter = createRateLimiter({
  limit: RUNS_RATE_LIMIT_PER_MIN,
  windowMs: 60_000,
});

type RunsResult =
  "ok" | "validation_error" | "upstream_error" | "internal_error";

const getMeter = () => metrics.getMeter("train-tracker-api");

let runsRequestsCounter: Counter | undefined;
const getRunsRequestsCounter = (): Counter =>
  (runsRequestsCounter ??= getMeter().createCounter("trains.runs.requests", {
    description: "Train run-date lookups by result",
  }));

function recordRunsResult(result: RunsResult): void {
  getRunsRequestsCounter().add(1, { result });
}

const runsCache = createTtlCache<RunWeekdaysResult>(RUNS_CACHE_L1_TTL_MS);

/**
 * Shared, cross-instance cache layered under the local in-process cache.
 * Fail-open: when Redis is unavailable the probe simply runs again.
 */
const redisCache = (() => {
  const store = createRedisStore();
  if (!store) return undefined;
  return createRedisTtlCache<RunWeekdaysResult>(store, {
    ttlMs: RUNS_CACHE_TTL_MS,
    negativeTtlMs: 60_000,
    jitter: RUNS_CACHE_TTL_JITTER,
    keyPrefix: REDIS_KEY_PREFIX,
    compress: REDIS_COMPRESS,
    onError: (err, operation, key) => {
      logger.error({ err, operation, key }, "Redis cache operation failed");
    },
  });
})();

/** Shared probe result for a train, cached across the L1 and L2 layers. */
async function getProbeResult(trainNumber: string): Promise<RunWeekdaysResult> {
  return runsCache.getOrSet(trainNumber, async () => {
    if (redisCache) {
      const cached = await redisCache.get(trainNumber);
      if (cached.status === "hit") return cached.value;
    }

    const result = await probeTrainRuns(trainNumber);
    await redisCache?.set(trainNumber, result);
    return result;
  });
}

router.get(
  "/trains/runs",
  createRateLimitMiddleware(runsRateLimiter, (req) => req.ip ?? "unknown"),
  async (req, res): Promise<void> => {
    const param = req.query["train_number"];
    if (param === undefined || Array.isArray(param)) {
      recordRunsResult("validation_error");
      res.status(400).json({
        error: "train_number: Required",
      });
      return;
    }

    const parsed = GetTrainRunsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      recordRunsResult("validation_error");
      res.status(400).json({ error: zodErrorMessage(parsed.error) });
      return;
    }

    const { train_number } = parsed.data;
    const span = trace.getActiveSpan();

    try {
      const probe = await getProbeResult(train_number);
      if (probe.upstreamFailures > 0 && probe.observedRuns.length === 0) {
        recordRunsResult("upstream_error");
        span?.recordException(
          sanitizeException(new Error("all run probes failed upstream")),
        );
        span?.setStatus({ code: SpanStatusCode.ERROR });
        req.log.error(
          { train_number, upstreamFailures: probe.upstreamFailures },
          "Train run probe failed upstream",
        );
        res.status(502).json({ error: "Could not reach train data provider" });
        return;
      }

      const runs = computeRunDates(probe.weekdays);
      const payload = GetTrainRunsResponse.parse({ train_number, runs });
      recordRunsResult("ok");
      res.json(payload);
    } catch (err) {
      span?.recordException(sanitizeException(err));
      span?.setStatus({ code: SpanStatusCode.ERROR });
      recordRunsResult("internal_error");
      req.log.error({ err }, "Unexpected error");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;

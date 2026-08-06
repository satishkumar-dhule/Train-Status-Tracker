import { Router, type IRouter } from "express";
import {
  GetTrainStatusQueryParams,
  GetTrainStatusResponse,
} from "@workspace/api-zod";
import {
  TRAINS,
  findTrainByNumber,
  isValidApiDate,
} from "@workspace/trains-data";
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
import { envPositiveNumber } from "../lib/env";
import { zodErrorMessage } from "../lib/zod-errors";
import { sanitizeException } from "../lib/trace-attributes";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "../lib/providers/errors";
import { fetchStatusWithFailover } from "../lib/providers/orchestrator";
import { buildStatusProviders } from "../lib/providers/registry";

/** Routes for train running status lookups. */
const router: IRouter = Router();

const TRAIN_STATUS_CACHE_TTL_MS = envPositiveNumber(
  process.env,
  "STATUS_CACHE_TTL_MS",
  5 * 60 * 1000,
);

/** Local hot-path TTL; shorter than the shared (Redis) TTL so L1 re-promotes from L2. */
const STATUS_CACHE_L1_TTL_MS = envPositiveNumber(
  process.env,
  "STATUS_CACHE_L1_TTL_MS",
  30_000,
);

/** How long "train not found" results are cached to protect the upstream. */
const STATUS_CACHE_NEG_TTL_MS = envPositiveNumber(
  process.env,
  "STATUS_CACHE_NEG_TTL_MS",
  60_000,
);

/** TTL randomization (±fraction) to stagger cross-instance expiry. */
const STATUS_CACHE_TTL_JITTER = envPositiveNumber(
  process.env,
  "STATUS_CACHE_TTL_JITTER",
  0.1,
);

const REDIS_KEY_PREFIX = process.env.REDIS_KEY_PREFIX ?? "tt:status:v1";

const REDIS_COMPRESS = process.env.REDIS_GZIP !== "false";

type TrainStatusPayload = ReturnType<typeof GetTrainStatusResponse.parse>;

type StatusResult =
  "ok" | "validation_error" | "not_found" | "upstream_error" | "internal_error";

const getMeter = () => metrics.getMeter("train-tracker-api");

let statusRequestsCounter: Counter | undefined;
const getStatusRequestsCounter = (): Counter =>
  (statusRequestsCounter ??= getMeter().createCounter(
    "trains.status.requests",
    {
      description: "Train status lookups by result",
    },
  ));

function recordStatusResult(result: StatusResult): void {
  getStatusRequestsCounter().add(1, { result });
}

function annotateTrainSpan(result: StatusResult): void {
  const span = trace.getActiveSpan();
  span?.setAttribute("trains.result", result);
}

const statusCache = createTtlCache<TrainStatusPayload>(STATUS_CACHE_L1_TTL_MS);

/**
 * Train status upstreams in priority order. Configured via
 * `TRAIN_STATUS_PROVIDERS` (comma-separated) or the default order; the
 * orchestrator fails over across them on upstream errors.
 */
const statusProviders = buildStatusProviders(process.env);

/**
 * Shared, cross-instance cache (Render Key Value) layered under the local
 * in-process cache. Fail-open: when Redis is unavailable the producer simply
 * falls through to the upstream and the in-memory cache still works.
 */
const redisCache = (() => {
  const store = createRedisStore();
  if (!store) return undefined;
  return createRedisTtlCache<TrainStatusPayload>(store, {
    ttlMs: TRAIN_STATUS_CACHE_TTL_MS,
    negativeTtlMs: STATUS_CACHE_NEG_TTL_MS,
    jitter: STATUS_CACHE_TTL_JITTER,
    keyPrefix: REDIS_KEY_PREFIX,
    compress: REDIS_COMPRESS,
    onError: (err, operation, key) => {
      logger.error({ err, operation, key }, "Redis cache operation failed");
    },
  });
})();

router.get("/trains/status", async (req, res): Promise<void> => {
  // Express 5's query parser returns arrays for repeated params (e.g.
  // `?train_number=1&train_number=2`), and the generated coerce schema would
  // silently stringify them. Reject missing and repeated params up front so
  // they fail validation with a clean message instead.
  const issues: {
    code: string;
    message: string;
    path: string[];
    expected?: string;
    received?: string;
  }[] = [];

  for (const param of Object.keys(GetTrainStatusQueryParams.shape)) {
    const value = req.query[param];
    if (value === undefined) {
      issues.push({ code: "invalid_type", message: "Required", path: [param] });
    } else if (Array.isArray(value)) {
      issues.push({
        code: "invalid_type",
        expected: "string",
        received: "array",
        path: [param],
        message: "Required",
      });
    }
  }

  if (issues.length > 0) {
    recordStatusResult("validation_error");
    res.status(400).json({ error: zodErrorMessage({ issues }) });
    return;
  }

  const parsed = GetTrainStatusQueryParams.safeParse(req.query);
  if (!parsed.success) {
    recordStatusResult("validation_error");
    res.status(400).json({ error: zodErrorMessage(parsed.error) });
    return;
  }

  const { train_number, departure_date } = parsed.data;

  if (!isValidApiDate(departure_date)) {
    recordStatusResult("validation_error");
    res.status(400).json({
      error: "departure_date must be a valid date in YYYYMMDD format",
    });
    return;
  }

  const key = `${train_number}:${departure_date}`;

  try {
    const payload = await statusCache.getOrSet(key, async () => {
      if (redisCache) {
        const cached = await redisCache.get(key);
        if (cached.status === "hit") return cached.value;
        if (cached.status === "negative") {
          throw new TrainStatusNotFoundError(
            "all",
            "Train not found or no data available",
          );
        }
      }

      try {
        const upstream = await fetchStatusWithFailover(
          statusProviders,
          train_number,
          departure_date,
          {
            knownTrain: findTrainByNumber(TRAINS, train_number) ?? null,
          },
        );
        const payload = GetTrainStatusResponse.parse(upstream);
        await redisCache?.set(key, payload);
        return payload;
      } catch (err) {
        if (err instanceof TrainStatusNotFoundError) {
          await redisCache?.setNegative(key);
        }
        throw err;
      }
    });
    annotateTrainSpan("ok");
    recordStatusResult("ok");
    res.json(payload);
  } catch (err) {
    if (err instanceof TrainStatusNotFoundError) {
      annotateTrainSpan("not_found");
      trace.getActiveSpan()?.setStatus({
        code: SpanStatusCode.ERROR,
        message: "train not found",
      });
      recordStatusResult("not_found");
      res.status(404).json({ error: "Train not found or no data available" });
      return;
    }
    if (err instanceof TrainStatusUpstreamError) {
      annotateTrainSpan("upstream_error");
      const span = trace.getActiveSpan();
      span?.recordException(sanitizeException(err));
      span?.setStatus({ code: SpanStatusCode.ERROR });
      recordStatusResult("upstream_error");
      req.log.error({ err }, "Upstream fetch failed");
      res.status(502).json({ error: "Could not reach train data provider" });
      return;
    }
    annotateTrainSpan("internal_error");
    const span = trace.getActiveSpan();
    span?.recordException(sanitizeException(err));
    span?.setStatus({ code: SpanStatusCode.ERROR });
    recordStatusResult("internal_error");
    req.log.error({ err }, "Unexpected error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

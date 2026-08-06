import {
  context,
  metrics,
  trace,
  SpanKind,
  SpanStatusCode,
  ValueType,
  type Counter,
  type Histogram,
} from "@opentelemetry/api";
import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_SERVER_ADDRESS,
  ATTR_SERVER_PORT,
  ATTR_URL_FULL,
} from "@opentelemetry/semantic-conventions";
import { performance } from "node:perf_hooks";
import { redactUrl, sanitizeException } from "../trace-attributes";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import type { MappedStatus } from "../train-status-mapper";
import type { ProviderFetchOptions } from "./types";

export const DEFAULT_UPSTREAM_TIMEOUT_MS = 10_000;
export const DEFAULT_UPSTREAM_MAX_BYTES = 2 * 1024 * 1024;

type UpstreamOutcome =
  | "success"
  | "not_found"
  | "timeout"
  | "abort"
  | "network_error"
  | "http_error"
  | "too_large"
  | "parse_error"
  | "map_error";

/**
 * Classifies a thrown fetch/body error. Node distinguishes the two abort
 * flavors: `AbortSignal.timeout` rejects with a `TimeoutError`, an external
 * controller abort rejects with an `AbortError`.
 */
function classifyFetchError(err: unknown): UpstreamOutcome {
  const name = err instanceof Error ? err.name : "";
  if (name === "TimeoutError") return "timeout";
  if (name === "AbortError") return "abort";
  return "network_error";
}

/**
 * Shared transport + telemetry for every train status provider. Adapters only
 * supply the endpoint/request and a `map` closure that turns the (untrusted)
 * payload into a `MappedStatus`; everything about calling upstreams — timeouts,
 * error classification, spans, metrics, redaction — lives here once (DRY).
 */
export interface ProviderRequestSpec {
  provider: string;
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Parse the response as JSON; otherwise return raw text (HTML scrapers). */
  responseType: "json" | "text";
  map: (payload: unknown) => MappedStatus;
}

const getMeter = () => metrics.getMeter("train-tracker-api");
const getTracer = () => trace.getTracer("train-tracker-api", "0.0.0");

let upstreamRequestsCounter: Counter | undefined;
const getUpstreamRequestsCounter = (): Counter =>
  (upstreamRequestsCounter ??= getMeter().createCounter(
    "trains.status.upstream.requests",
    {
      description: "Train status upstream API calls by provider and outcome",
    },
  ));

let upstreamDurationHistogram: Histogram | undefined;
const getUpstreamDurationHistogram = (): Histogram =>
  (upstreamDurationHistogram ??= getMeter().createHistogram(
    "trains.status.upstream.duration",
    {
      description: "Train status upstream API call latency",
      unit: "s",
      valueType: ValueType.DOUBLE,
    },
  ));

function combineSignals(
  internal: AbortSignal,
  external?: AbortSignal,
): AbortSignal {
  if (!external) return internal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([internal, external]);
  }
  return external;
}

export async function fetchProviderStatus(
  spec: ProviderRequestSpec,
  options: ProviderFetchOptions = {},
): Promise<MappedStatus> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(spec.url);

  const span = getTracer().startSpan(`${spec.provider}.train_status.fetch`, {
    kind: SpanKind.CLIENT,
    attributes: {
      [ATTR_URL_FULL]: redactUrl(url.toString()),
      [ATTR_HTTP_REQUEST_METHOD]: spec.method ?? "GET",
      [ATTR_SERVER_ADDRESS]: url.hostname,
      [ATTR_SERVER_PORT]: Number(url.port) || 443,
      "provider.name": spec.provider,
    },
  });

  const startedAt = performance.now();
  let outcome: UpstreamOutcome = "success";

  try {
    // Activate the span so the fetch request and any downstream instrumented
    // work nest under it instead of dangling as root spans.
    return await context.with(trace.setSpan(context.active(), span), async () => {
      let upstream: Response;
      try {
        upstream = await fetchImpl(spec.url, {
          method: spec.method ?? "GET",
          headers: spec.headers,
          body: spec.body,
          signal: combineSignals(
            AbortSignal.timeout(spec.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS),
            options.signal,
          ),
        });
      } catch (err) {
        outcome = classifyFetchError(err);
        span.recordException(sanitizeException(err));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw new TrainStatusUpstreamError(
          spec.provider,
          `Network error reaching ${spec.provider}`,
          { cause: err },
        );
      }

      if (!upstream.ok) {
        outcome = "http_error";
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${upstream.status}`,
        });
        throw new TrainStatusUpstreamError(
          spec.provider,
          `${spec.provider} returned status ${upstream.status}`,
        );
      }

      if (
        Number(upstream.headers.get("content-length")) > DEFAULT_UPSTREAM_MAX_BYTES
      ) {
        outcome = "too_large";
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: "response too large",
        });
        throw new TrainStatusUpstreamError(
          spec.provider,
          `${spec.provider} response too large`,
        );
      }

      let payload: unknown;
      try {
        payload =
          spec.responseType === "json"
            ? await upstream.json()
            : await upstream.text();
      } catch (err) {
        outcome = "parse_error";
        span.recordException(sanitizeException(err));
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw new TrainStatusUpstreamError(
          spec.provider,
          `Invalid response body from ${spec.provider}`,
          { cause: err },
        );
      }

      try {
        return spec.map(payload);
      } catch (err) {
        if (err instanceof TrainStatusNotFoundError) {
          outcome = "not_found";
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: "train not found",
          });
        } else {
          outcome = "map_error";
          span.recordException(sanitizeException(err));
          span.setStatus({ code: SpanStatusCode.ERROR });
          if (err instanceof TrainStatusUpstreamError) {
            throw err;
          }
          throw new TrainStatusUpstreamError(
            spec.provider,
            `Unexpected error mapping ${spec.provider} response`,
            { cause: err },
          );
        }
        throw err;
      }
    });
  } finally {
    const durationSec = (performance.now() - startedAt) / 1000;
    getUpstreamRequestsCounter().add(1, { provider: spec.provider, outcome });
    getUpstreamDurationHistogram().record(durationSec, {
      provider: spec.provider,
      outcome,
    });
    span.end();
  }
}

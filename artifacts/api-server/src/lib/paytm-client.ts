import {
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
import { redactUrl, sanitizeException } from "./trace-attributes";

const PAYTM_BASE = "https://travel.paytm.com/api/trains/v1/train/status";

const TIMEOUT_MS = 10_000;

export interface PaytmStation {
  stnSerialNumber?: string | number;
  stationCode?: string;
  stationName?: string;
  arrivalTime?: string;
  departureTime?: string;
  dayCount?: string | number;
  actual_arrival_time?: string | null;
  actual_departure_time?: string | null;
  distance?: string | number;
  expected_platform?: string | number;
  haltTime?: number;
}

export interface PaytmTrainStatusPayload {
  stations: PaytmStation[];
  current_station: string | null;
  train_status_message?: string | null;
  server_timestamp?: string | null;
}

export interface PaytmFetchOptions {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export class PaytmUpstreamError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PaytmUpstreamError";
  }
}

export class PaytmTrainNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PaytmTrainNotFoundError";
  }
}

type UpstreamOutcome = "success" | "not_found" | "upstream_error";

const getMeter = () => metrics.getMeter("train-tracker-api");
const getTracer = () => trace.getTracer("train-tracker-api", "0.0.0");

let upstreamRequestsCounter: Counter | undefined;
const getUpstreamRequestsCounter = (): Counter =>
  (upstreamRequestsCounter ??= getMeter().createCounter(
    "trains.status.upstream.requests",
    {
      description: "Paytm upstream API calls by outcome",
    },
  ));

let upstreamDurationHistogram: Histogram | undefined;
const getUpstreamDurationHistogram = (): Histogram =>
  (upstreamDurationHistogram ??= getMeter().createHistogram(
    "trains.status.upstream.duration",
    {
      description: "Paytm upstream API call latency",
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

export async function fetchPaytmTrainStatus(
  trainNumber: string,
  departureDate: string,
  options: PaytmFetchOptions = {},
): Promise<PaytmTrainStatusPayload> {
  const fetchImpl = options.fetchImpl ?? fetch;

  const upstreamUrl = new URL(PAYTM_BASE);
  upstreamUrl.searchParams.set("train_number", trainNumber);
  upstreamUrl.searchParams.set("departure_date", departureDate);
  upstreamUrl.searchParams.set("isH5", "true");
  upstreamUrl.searchParams.set("client", "web");
  upstreamUrl.searchParams.set("deviceIdentifier", "Mozilla Firefox-150.0.0.0");

  const span = getTracer().startSpan("paytm.train_status.fetch", {
    kind: SpanKind.CLIENT,
    attributes: {
      [ATTR_URL_FULL]: redactUrl(upstreamUrl.toString()),
      [ATTR_HTTP_REQUEST_METHOD]: "GET",
      [ATTR_SERVER_ADDRESS]: upstreamUrl.hostname,
      [ATTR_SERVER_PORT]: Number(upstreamUrl.port) || 443,
    },
  });

  const startedAt = performance.now();
  let outcome: UpstreamOutcome = "success";

  try {
    let upstream: Response;
    try {
      upstream = await fetchImpl(upstreamUrl.toString(), {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
          Accept: "application/json",
        },
        signal: combineSignals(AbortSignal.timeout(TIMEOUT_MS), options.signal),
      });
    } catch (err) {
      throw new PaytmUpstreamError("Network error reaching Paytm", {
        cause: err,
      });
    }

    if (!upstream.ok) {
      throw new PaytmUpstreamError(`Paytm returned status ${upstream.status}`);
    }

    let raw: unknown;
    try {
      raw = await upstream.json();
    } catch (err) {
      throw new PaytmUpstreamError("Invalid JSON from Paytm", { cause: err });
    }

    if (!raw || typeof raw !== "object") {
      throw new PaytmUpstreamError("Unexpected response shape from Paytm");
    }

    if ("error" in raw && raw.error) {
      const status = "status" in raw ? raw.status : {};
      const result =
        typeof status === "object" && status !== null && "result" in status
          ? String(status.result)
          : "";
      // Only a positively-confirmed `failure` result is a genuine "train not
      // found". Anything else the provider flags as errored (transient
      // outages, empty results, unknown codes) is ambiguous and must surface
      // as an upstream error — otherwise a momentary glitch gets cached as a
      // permanent 404 marker shared by all users.
      if (result === "failure") {
        throw new PaytmTrainNotFoundError(
          "Train not found or no data available",
        );
      }
      if (result !== "success") {
        throw new PaytmUpstreamError(
          `Paytm reported an unsuccessful result: "${result}"`,
        );
      }
    }

    if (!("body" in raw) || !raw.body || typeof raw.body !== "object") {
      throw new PaytmUpstreamError("Unexpected response shape from Paytm");
    }

    const body = raw.body as Record<string, unknown>;
    const rawStations = Array.isArray(body.stations) ? body.stations : [];

    return {
      stations: rawStations as PaytmStation[],
      current_station:
        typeof body.current_station === "string" ? body.current_station : null,
      train_status_message:
        typeof body.train_status_message === "string"
          ? body.train_status_message
          : null,
      server_timestamp:
        typeof body.server_timestamp === "string"
          ? body.server_timestamp
          : null,
    };
  } catch (err) {
    if (err instanceof PaytmTrainNotFoundError) {
      outcome = "not_found";
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: "train not found",
      });
    } else {
      outcome = "upstream_error";
      span.recordException(sanitizeException(err));
      span.setStatus({ code: SpanStatusCode.ERROR });
    }
    throw err;
  } finally {
    const durationSec = (performance.now() - startedAt) / 1000;
    getUpstreamRequestsCounter().add(1, { outcome });
    getUpstreamDurationHistogram().record(durationSec, { outcome });
    span.end();
  }
}

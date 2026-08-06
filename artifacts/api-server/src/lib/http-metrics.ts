import { metrics, type Attributes, type Histogram, type UpDownCounter, ValueType } from "@opentelemetry/api";

const getMeter = () => metrics.getMeter("train-tracker-api");

let requestDurationHistogram: Histogram | undefined;
/** Route-scoped RED metric. Uses an `app.` namespace so it never collides with
 * the `http.server.request.duration` emitted by the auto http instrumentation
 * (which cannot know the Express route). */
function getRequestDuration(): Histogram {
  return (requestDurationHistogram ??= getMeter().createHistogram(
    "app.http.request.duration",
    {
      description: "HTTP server request duration in seconds, by route.",
      unit: "s",
      valueType: ValueType.DOUBLE,
      advice: {
        explicitBucketBoundaries: [
          0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5,
          7.5, 10,
        ],
      },
    },
  ));
}

let activeRequestsCounter: UpDownCounter | undefined;
/** Number of HTTP requests currently in flight. */
function getActiveRequests(): UpDownCounter {
  return (activeRequestsCounter ??= getMeter().createUpDownCounter(
    "http.server.active_requests",
    {
      description: "Number of HTTP requests currently in flight.",
      unit: "{request}",
    },
  ));
}

/** Records completion metrics for a single request. Idempotent and cheap; the
 * route falls back to `unmatched` so arbitrary 404 paths cannot inflate
 * attribute cardinality. */
export function observeRequestCompletion(
  startTime: number,
  attributes: Attributes,
): void {
  const elapsedSeconds = (performance.now() - startTime) / 1_000;
  getRequestDuration().record(elapsedSeconds, attributes);
}

/** Tracks a request entering the server. Call with `+1` on entry and `-1` on
 * finish so the gauge reflects real concurrency. */
export function changeActiveRequests(delta: number): void {
  getActiveRequests().add(delta);
}

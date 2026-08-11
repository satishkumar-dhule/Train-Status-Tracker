import { logger } from "../logger";
import { metrics, trace, type Counter } from "@opentelemetry/api";
import { TrainStatusNotFoundError, TrainStatusUpstreamError } from "./errors";
import type {
  KnownTrain,
  ProviderFetchOptions,
  TrainStatusProvider,
} from "./types";
import type { MappedStatus } from "../train-status-mapper";
import { defaultQosRegistry, type QosRegistry } from "./qos";
import { performance } from "node:perf_hooks";

export interface FailoverOptions {
  fetchOptions?: ProviderFetchOptions;
  knownTrain?: KnownTrain | null;
  /** QoS registry consulted for circuit breaking; shared one by default. */
  qos?: QosRegistry;
  /**
   * Pin the lookup to a single provider by name, skipping the failover chain
   * entirely (no other provider is consulted, whatever the QoS state). The
   * caller is responsible for pre-validating that the provider is enabled.
   */
  pinnedProvider?: string;
}

const getMeter = () => metrics.getMeter("train-tracker-api");

let failoverCounter: Counter | undefined;
const getFailoverCounter = (): Counter =>
  (failoverCounter ??= getMeter().createCounter("app.provider.failover", {
    description:
      "Train status lookups that needed failover, by outcome and attempts",
  }));

function recordFailover(
  outcome: "recovered" | "not_found" | "upstream_error",
  attempts: number,
): void {
  getFailoverCounter().add(1, { outcome, attempts });
}

function isTimeoutError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 3 && current != null; depth += 1) {
    if (
      typeof current === "object" &&
      (current as { name?: unknown }).name === "TimeoutError"
    ) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Try each enabled provider in order until one returns a status.
 *
 * ZTA policy for classification:
 * - Only a 404 from *every* consulted provider is treated as "train not
 *   found". A single ambiguous/errored provider must not poison the shared
 *   negative cache with a false 404.
 * - If every provider errors, surface an upstream error.
 * - Any other thrown error (a programming bug) is rethrown immediately rather
 *   than masked by failover.
 *
 * QoS: every consulted call is recorded in the QoS registry (outcome, latency,
 * timeouts). Providers with `failureThreshold` consecutive upstream failures
 * are skipped for a cooldown period so a dead upstream stops burning its full
 * timeout on every request. If every provider is in cooldown the first one is
 * still force-tried so a healthy upstream is never hidden by the breaker.
 */
export async function fetchStatusWithFailover(
  providers: readonly TrainStatusProvider[],
  trainNumber: string,
  departureDate: string,
  options: FailoverOptions = {},
): Promise<MappedStatus> {
  const qos: QosRegistry = options.qos ?? defaultQosRegistry;
  const enabled = providers.filter((provider) => provider.enabled);

  // A pinned provider is consulted unconditionally — the user explicitly
  // asked for it, so neither failover nor the circuit breaker may override it.
  const pinned =
    options.pinnedProvider !== undefined
      ? enabled.find((provider) => provider.name === options.pinnedProvider)
      : undefined;

  // Defense in depth: routes validate the pinned provider before calling, but
  // never silently fall back to failover when a requested provider is absent.
  if (options.pinnedProvider !== undefined && pinned === undefined) {
    throw new TrainStatusUpstreamError(
      options.pinnedProvider,
      `Train status provider "${options.pinnedProvider}" is not configured`,
    );
  }

  const available = enabled.filter((provider) => qos.isAvailable(provider.name));
  const toConsult =
    pinned !== undefined
      ? [pinned]
      : available.length > 0
        ? available
        : enabled.slice(0, 1);
  for (const provider of enabled) {
    if (
      !toConsult.includes(provider) &&
      qos.isAvailable(provider.name) === false
    ) {
      logger.warn(
        { provider: provider.name },
        "Skipping train status provider in QoS cooldown",
      );
    }
  }

  const notFoundProviders = new Set<string>();
  const upstreamErrors: TrainStatusUpstreamError[] = [];

  for (const provider of toConsult) {
    const startedAt = performance.now();
    try {
      const status = await provider.fetchTrainStatus(
        trainNumber,
        departureDate,
        options.fetchOptions ?? {},
        options.knownTrain ?? null,
      );
      qos.record(provider.name, {
        outcome: "success",
        latencyMs: performance.now() - startedAt,
      });
      if (upstreamErrors.length > 0) {
        recordFailover("recovered", upstreamErrors.length + 1);
        // Tag the request span with the number of providers consulted so
        // latency anomalies can be traced back to a fallback chain.
        trace
          .getActiveSpan()
          ?.setAttribute("app.failover.providers_consulted", upstreamErrors.length + 1);
        logger.warn(
          {
            trainNumber,
            departureDate,
            provider: provider.name,
            failedProviders: upstreamErrors.map((err) => err.provider),
          },
          "Train status failover recovered",
        );
      }
      return { ...status, provider: provider.name };
    } catch (err) {
      const latencyMs = performance.now() - startedAt;
      if (err instanceof TrainStatusNotFoundError) {
        qos.record(provider.name, { outcome: "not_found", latencyMs });
        notFoundProviders.add(provider.name);
        continue;
      }
      if (err instanceof TrainStatusUpstreamError) {
        qos.record(provider.name, {
          outcome: "upstream_error",
          latencyMs,
          timeout: isTimeoutError(err),
          error: err.message,
        });
        upstreamErrors.push(err);
        logger.warn(
          {
            trainNumber,
            departureDate,
            provider: provider.name,
            message: err.message,
          },
          "Train status provider failed, trying next",
        );
        continue;
      }
      throw err;
    }
  }

  if (toConsult.length > 0 && notFoundProviders.size === toConsult.length) {
    recordFailover("not_found", toConsult.length);
    throw new TrainStatusNotFoundError(
      "all",
      "Train not found or no data available",
    );
  }
  if (upstreamErrors.length > 0) {
    recordFailover("upstream_error", upstreamErrors.length);
    throw new TrainStatusUpstreamError(
      "all",
      "All train status providers failed",
      { cause: new AggregateError(upstreamErrors) },
    );
  }
  throw new TrainStatusUpstreamError(
    "all",
    "No train status providers are configured",
  );
}

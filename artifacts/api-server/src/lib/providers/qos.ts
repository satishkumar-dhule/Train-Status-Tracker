import { envPositiveNumber } from "../env";

/**
 * Per-provider quality-of-service tracking for train status upstreams.
 *
 * Every provider call made through `fetchProviderStatus` is recorded here
 * (outcome, latency, timeout) so each upstream can be watched independently
 * and the orchestrator can skip providers that keep failing instead of
 * burning a timeout on every request.
 */
export type ProviderQosOutcome = "success" | "not_found" | "upstream_error";

export interface QosRecord {
  outcome: ProviderQosOutcome;
  latencyMs: number;
  /** Only meaningful for `upstream_error`; distinguishes timeouts. */
  timeout?: boolean;
  /** Last upstream error message, for diagnostics. */
  error?: string | null;
}

export interface QosRegistryOptions {
  /**
   * Consecutive upstream failures after which a provider is treated as down
   * and skipped by the orchestrator (until `cooldownMs` elapses).
   */
  failureThreshold: number;
  /** How long a down provider is skipped before being tried again. */
  cooldownMs: number;
  /** Rolling latency window kept per provider (drives avg/p95). */
  maxLatencySamples: number;
}

export type ProviderQosStatus = "ok" | "degraded" | "down";

export interface ProviderQosSnapshot {
  name: string;
  requests: number;
  successes: number;
  notFound: number;
  upstreamErrors: number;
  timeouts: number;
  consecutiveFailures: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number | null;
  status: ProviderQosStatus;
  /** Whether the provider is currently being consulted by the orchestrator. */
  available: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

interface ProviderQosData {
  requests: number;
  successes: number;
  notFound: number;
  upstreamErrors: number;
  timeouts: number;
  consecutiveFailures: number;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
  latencies: number[];
}

export const DEFAULT_QOS_OPTIONS: Required<QosRegistryOptions> = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  maxLatencySamples: 100,
};

function emptyData(): ProviderQosData {
  return {
    requests: 0,
    successes: 0,
    notFound: 0,
    upstreamErrors: 0,
    timeouts: 0,
    consecutiveFailures: 0,
    lastError: null,
    lastErrorAt: null,
    lastSuccessAt: null,
    latencies: [],
  };
}

function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(p * sorted.length) - 1),
  );
  return sorted[index];
}

export class QosRegistry {
  private readonly options: Required<QosRegistryOptions>;
  private readonly data = new Map<string, ProviderQosData>();

  constructor(options: Partial<QosRegistryOptions> = {}) {
    this.options = { ...DEFAULT_QOS_OPTIONS, ...options };
  }

  record(name: string, event: QosRecord): void {
    const entry = this.data.get(name) ?? emptyData();
    entry.requests += 1;
    entry.latencies.push(event.latencyMs);
    if (entry.latencies.length > this.options.maxLatencySamples) {
      entry.latencies.shift();
    }

    switch (event.outcome) {
      case "success":
        entry.successes += 1;
        entry.consecutiveFailures = 0;
        entry.lastSuccessAt = new Date().toISOString();
        break;
      case "not_found":
        // An authoritative "no data" answer is a healthy response.
        entry.notFound += 1;
        entry.consecutiveFailures = 0;
        break;
      case "upstream_error":
        entry.upstreamErrors += 1;
        entry.consecutiveFailures += 1;
        entry.lastError = event.error ?? "upstream error";
        entry.lastErrorAt = new Date().toISOString();
        if (event.timeout) entry.timeouts += 1;
        break;
    }

    this.data.set(name, entry);
  }

  /**
   * True when the provider may be consulted. Providers with fewer than
   * `failureThreshold` consecutive failures — or past their cooldown — are
   * always available; unknown providers are assumed healthy.
   */
  isAvailable(name: string, now = Date.now()): boolean {
    const entry = this.data.get(name);
    if (!entry) return true;
    if (entry.consecutiveFailures < this.options.failureThreshold) return true;
    if (entry.lastErrorAt === null) return true;
    const lastErrorMs = Date.parse(entry.lastErrorAt);
    return now - lastErrorMs >= this.options.cooldownMs;
  }

  snapshot(name: string, now = Date.now()): ProviderQosSnapshot {
    const entry = this.data.get(name) ?? emptyData();
    const total = entry.requests;
    const errorRate = total === 0 ? 0 : entry.upstreamErrors / total;
    const sorted = [...entry.latencies].sort((a, b) => a - b);
    const sum = entry.latencies.reduce((acc, value) => acc + value, 0);

    let status: ProviderQosStatus = "ok";
    if (entry.consecutiveFailures >= this.options.failureThreshold) {
      status = "down";
    } else if (errorRate > 0.1 || entry.upstreamErrors > 0) {
      status = "degraded";
    }

    return {
      name,
      requests: entry.requests,
      successes: entry.successes,
      notFound: entry.notFound,
      upstreamErrors: entry.upstreamErrors,
      timeouts: entry.timeouts,
      consecutiveFailures: entry.consecutiveFailures,
      errorRate,
      avgLatencyMs: entry.latencies.length === 0 ? 0 : sum / entry.latencies.length,
      p95LatencyMs: percentile(sorted, 0.95),
      status,
      available: this.isAvailable(name, now),
      lastSuccessAt: entry.lastSuccessAt,
      lastError: entry.lastError,
      lastErrorAt: entry.lastErrorAt,
    };
  }

  /** Snapshots for the given names, in the given order, skipping unknowns. */
  snapshotFor(names: readonly string[], now = Date.now()): ProviderQosSnapshot[] {
    return names.map((name) => this.snapshot(name, now));
  }

  snapshotAll(now = Date.now()): ProviderQosSnapshot[] {
    return [...this.data.keys()].map((name) => this.snapshot(name, now));
  }

  reset(): void {
    this.data.clear();
  }
}

/** Build a registry from env, so tuning is deployable without code changes. */
export function createQosRegistryFromEnv(
  env: NodeJS.ProcessEnv,
): QosRegistry {
  return new QosRegistry({
    failureThreshold: envPositiveNumber(
      env,
      "TRAIN_STATUS_QOS_FAILURE_THRESHOLD",
      DEFAULT_QOS_OPTIONS.failureThreshold,
    ),
    cooldownMs: envPositiveNumber(
      env,
      "TRAIN_STATUS_QOS_COOLDOWN_MS",
      DEFAULT_QOS_OPTIONS.cooldownMs,
    ),
    maxLatencySamples: envPositiveNumber(
      env,
      "TRAIN_STATUS_QOS_LATENCY_SAMPLES",
      DEFAULT_QOS_OPTIONS.maxLatencySamples,
    ),
  });
}

/** Shared process-wide registry; tests use their own instance where needed. */
export const defaultQosRegistry = createQosRegistryFromEnv(process.env);

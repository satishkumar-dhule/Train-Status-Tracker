import type { HealthStatus } from "@workspace/api-client-react";
import {
  getBaseUrl,
  getGetTrainCatalogUrl,
  getGetTrainRunsUrl,
  getGetTrainStatusUrl,
  getSearchTrainsUrl,
} from "@workspace/api-client-react";
import { getUpcomingDates, toApiDate } from "@workspace/trains-data";

/**
 * API monitoring domain: endpoint probe definitions, the fan-out probe run,
 * snapshot aggregation and display formatters.
 *
 * Probes measure the raw HTTP surface (latency, payload bytes, status code),
 * not the parsed typed client, so a hung or misbehaving endpoint is visible
 * exactly as the browser sees it. URL paths reuse the generated client's URL
 * helpers, so endpoint definitions stay single-sourced.
 */

/** How often the monitoring page re-runs every probe (real-time baseline). */
export const MONITOR_POLL_INTERVAL_MS = 15_000;

/** A single probe is abandoned after this long so one hung endpoint cannot stall the whole cycle. */
export const MONITOR_PROBE_TIMEOUT_MS = 15_000;

/** The ops endpoint that reports per-provider QoS; not part of the public API client. */
const PROVIDERS_PATH = "/api/trains/providers";

/** The train used by the data-plane probes (runs + status). Always in the catalog. */
const PROBE_TRAIN_NUMBER = "22943";

/** The catalog search used by the search probe. */
const PROBE_SEARCH_QUERY = "rajdhani";

export type ProbeStatus = "ok" | "degraded" | "down";
export type OverallStatus = ProbeStatus | "pending";

export type ProbeId =
  | "health"
  | "catalog"
  | "search"
  | "runs"
  | "status"
  | "providers";

/** Per-provider QoS snapshot mirrored from `/api/trains/providers`. */
export interface ProviderHealth {
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
  status: ProbeStatus;
  available: boolean;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
}

/** One endpoint probe, ready to fire. Built per cycle so URLs stay current. */
export interface ProbeDefinition {
  id: ProbeId;
  label: string;
  method: string;
  path: string;
  /** Statuses the endpoint may legitimately return while healthy. */
  expectedStatuses: ReadonlySet<number>;
}

/** The measured outcome of a single probe. */
export interface ProbeResult {
  id: ProbeId;
  label: string;
  method: string;
  path: string;
  /** HTTP status, or null when the probe never got a response (network/timeout). */
  statusCode: number | null;
  latencyMs: number;
  payloadBytes: number;
  status: ProbeStatus;
  error: string | null;
  completedAt: number;
}

/** The aggregated result of one fan-out probe cycle. */
export interface MonitoringProbes {
  results: ProbeResult[];
  /** Parsed `/api/healthz` payload when the health probe succeeded. */
  health: HealthStatus | null;
  /** Number of trains in the catalog when the catalog probe succeeded. */
  catalogCount: number | null;
  /** Per-provider QoS snapshot when the providers probe succeeded. */
  providers: ProviderHealth[] | null;
  generatedAt: number;
}

export interface MonitoringSummary {
  overall: OverallStatus;
  ok: number;
  degraded: number;
  down: number;
  total: number;
  /** Fraction of probes classified ok (0..1). */
  successRate: number;
  avgLatencyMs: number | null;
  maxLatencyMs: number | null;
}

// ---------------------------------------------------------------------------
// Probe definitions
// ---------------------------------------------------------------------------

function resolveApiUrl(path: string): string {
  const base = getBaseUrl();
  return base ? `${base}${path}` : path;
}

/** Builds one probe definition per monitored endpoint for a given cycle. */
export function buildProbes(now: Date = new Date()): ProbeDefinition[] {
  const todayApi = toApiDate(getUpcomingDates(1, now)[0]);
  const ok2xx = new Set([200]);
  return [
    {
      id: "health",
      label: "Health",
      method: "GET",
      path: "/api/healthz",
      expectedStatuses: ok2xx,
    },
    {
      id: "catalog",
      label: "Train catalog",
      method: "GET",
      path: "/api/trains",
      expectedStatuses: ok2xx,
    },
    {
      id: "search",
      label: "Search",
      method: "GET",
      path: getSearchTrainsUrl({ q: PROBE_SEARCH_QUERY, limit: 5 }),
      expectedStatuses: ok2xx,
    },
    {
      id: "runs",
      label: "Run dates",
      method: "GET",
      path: getGetTrainRunsUrl({ train_number: PROBE_TRAIN_NUMBER }),
      expectedStatuses: ok2xx,
    },
    {
      id: "status",
      label: "Live status",
      method: "GET",
      path: getGetTrainStatusUrl({
        train_number: PROBE_TRAIN_NUMBER,
        departure_date: todayApi,
      }),
      // A 404 is a legitimate application answer (train not running today);
      // the endpoint itself is healthy.
      expectedStatuses: new Set([200, 404]),
    },
    {
      id: "providers",
      label: "Providers",
      method: "GET",
      path: PROVIDERS_PATH,
      expectedStatuses: ok2xx,
    },
  ];
}

// ---------------------------------------------------------------------------
// Probe execution (fan-out)
// ---------------------------------------------------------------------------

/** Classifies a measured probe outcome against the endpoint's expected statuses. */
export function classifyProbe(
  statusCode: number | null,
  expectedStatuses: ReadonlySet<number>,
): ProbeStatus {
  if (statusCode === null) return "down";
  if (expectedStatuses.has(statusCode)) return "ok";
  if (statusCode >= 400 && statusCode < 500) return "degraded";
  return "down";
}

/** UTF-8 byte length of a value, approximating the wire size of a JSON payload. */
export function measureBytes(value: unknown): number {
  if (typeof value === "string") return new Blob([value]).size;
  return new Blob([JSON.stringify(value)]).size;
}

function trimError(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (typeof parsed === "object" && parsed !== null) {
      const error = (parsed as { error?: unknown }).error;
      if (typeof error === "string" && error !== "") return error;
    }
  } catch {
    // Non-JSON body (e.g. HTML error page); fall back to the raw text.
  }
  return trimmed.length > 200 ? `${trimmed.slice(0, 199)}…` : trimmed;
}

function parseMeta(
  id: ProbeId,
  statusCode: number | null,
  text: string,
):
  | { health: HealthStatus }
  | { catalogCount: number }
  | { providers: ProviderHealth[] }
  | {} {
  if (statusCode === null || statusCode < 200 || statusCode >= 300) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    switch (id) {
      case "health":
        return { health: parsed as HealthStatus };
      case "catalog": {
        const trains = (parsed as { trains?: unknown[] | null })?.trains;
        return { catalogCount: Array.isArray(trains) ? trains.length : 0 };
      }
      case "providers": {
        const providers = (parsed as { providers?: unknown[] | null })
          ?.providers;
        return {
          providers: Array.isArray(providers)
            ? (providers as ProviderHealth[])
            : [],
        };
      }
      default:
        return {};
    }
  } catch {
    return {};
  }
}

async function runProbe(def: ProbeDefinition, timeoutMs: number) {
  const startedAt = performance.now();
  let statusCode: number | null = null;
  let text = "";
  try {
    const response = await fetch(resolveApiUrl(def.path), {
      method: def.method,
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    statusCode = response.status;
    text = await response.text();
    if (!response.ok) {
      throw new Error(trimError(text) ?? `HTTP ${response.status}`);
    }
  } catch (err) {
    // Falls through: the probe records the failure with whatever status code
    // (if any) was observed before the error.
  }
  const latencyMs = performance.now() - startedAt;
  const result: ProbeResult = {
    id: def.id,
    label: def.label,
    method: def.method,
    path: def.path,
    statusCode,
    latencyMs,
    payloadBytes: measureBytes(text),
    status: classifyProbe(statusCode, def.expectedStatuses),
    error:
      statusCode === null
        ? "Network or timeout error"
        : trimError(text) ?? `HTTP ${statusCode}`,
    completedAt: Date.now(),
  };
  return { result, ...parseMeta(def.id, statusCode, text) };
}

/**
 * Runs every probe in parallel and assembles one monitoring snapshot.
 * `timeoutMs` is injectable so tests exercise timeouts without waiting.
 */
export async function runProbes(
  now: Date = new Date(),
  timeoutMs: number = MONITOR_PROBE_TIMEOUT_MS,
): Promise<MonitoringProbes> {
  const runs = await Promise.all(buildProbes(now).map((def) => runProbe(def, timeoutMs)));
  const snapshot: MonitoringProbes = {
    results: runs.map((run) => run.result),
    health: null,
    catalogCount: null,
    providers: null,
    generatedAt: Date.now(),
  };
  for (const run of runs) {
    if ("health" in run && run.health) snapshot.health = run.health;
    if ("catalogCount" in run && run.catalogCount !== undefined) {
      snapshot.catalogCount = run.catalogCount;
    }
    if ("providers" in run && run.providers !== undefined) {
      snapshot.providers = run.providers;
    }
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/** Derives the overall page status from a probe run: worst status wins. */
export function summarizeProbes(results: readonly ProbeResult[]): MonitoringSummary {
  if (results.length === 0) {
    return {
      overall: "pending",
      ok: 0,
      degraded: 0,
      down: 0,
      total: 0,
      successRate: 0,
      avgLatencyMs: null,
      maxLatencyMs: null,
    };
  }
  const ok = results.filter((result) => result.status === "ok").length;
  const degraded = results.filter((result) => result.status === "degraded").length;
  const down = results.length - ok - degraded;
  const latencies = results.map((result) => result.latencyMs);
  const avgLatencyMs = latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length;
  return {
    overall: down > 0 ? "down" : degraded > 0 ? "degraded" : "ok",
    ok,
    degraded,
    down,
    total: results.length,
    successRate: ok / results.length,
    avgLatencyMs,
    maxLatencyMs: Math.max(...latencies),
  };
}

// ---------------------------------------------------------------------------
// Formatters (re-exported from the consolidated format module)
// ---------------------------------------------------------------------------

export {
  formatLatency,
  formatBytes,
  formatUptime,
  formatStatusCode,
  formatRelativeTime,
} from "@/lib/format";

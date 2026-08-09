import {
  Activity,
  AlertTriangle,
  Pause,
  Play,
  RefreshCw,
} from "lucide-react";
import type { ProviderHealth, ProbeResult } from "../lib/api-monitoring";
import {
  MONITOR_POLL_INTERVAL_MS,
  formatBytes,
  formatLatency,
  formatRelativeTime,
  formatStatusCode,
  formatUptime,
} from "../lib/api-monitoring";
import type { MonitoringResult } from "../hooks/use-api-monitoring";
import { cn } from "../lib/utils";

const STATUS_STYLES = {
  ok: "bg-success/10 text-success border-success/30",
  degraded: "bg-warning/10 text-warning border-warning/30",
  down: "bg-destructive/10 text-destructive border-destructive/30",
  pending: "bg-muted text-muted-foreground border-border",
} as const;

const OVERALL_LABELS = {
  ok: "OK",
  degraded: "DEGRADED",
  down: "DOWN",
  pending: "PENDING",
} as const;

function StatusPill({
  status,
  testId,
  pulse = false,
}: {
  status: keyof typeof STATUS_STYLES;
  testId?: string;
  pulse?: boolean;
}) {
  return (
    <span
      data-testid={testId}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-bold uppercase tracking-widest",
        STATUS_STYLES[status],
      )}
    >
      {pulse && status !== "pending" && (
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full bg-current",
            status !== "down" && "animate-pulse",
          )}
          aria-hidden
        />
      )}
      {OVERALL_LABELS[status]}
    </span>
  );
}

function Stat({
  label,
  value,
  testId,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  testId?: string;
  tone?: "success" | "warning" | "destructive" | "muted";
}) {
  return (
    <div className="min-w-0 rounded-xl border border-card-border bg-card p-3">
      <div className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div
        data-testid={testId}
        className={cn(
          "mt-1 truncate font-mono text-base font-bold text-foreground",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value ?? "--"}
      </div>
    </div>
  );
}

/** Tiny inline latency sparkline: one point per completed probe cycle. */
function Sparkline({
  samples,
  tone,
  testId,
}: {
  samples: readonly number[];
  tone: "success" | "warning" | "destructive";
  testId?: string;
}) {
  if (samples.length === 0) return null;
  const width = 100;
  const height = 24;
  const max = Math.max(...samples, 1);
  const min = Math.min(...samples);
  const range = Math.max(max - min, 1);
  const step = width / (samples.length - 1 || 1);
  const points = samples
    .map((ms, index) => {
      const x = index * step;
      const y = height - 3 - ((ms - min) / range) * (height - 6);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-6 w-20"
      aria-hidden
      data-testid={testId}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className={cn(
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "destructive" && "text-destructive",
        )}
      />
    </svg>
  );
}

function probeTone(probe: ProbeResult): "success" | "warning" | "destructive" {
  if (probe.status === "ok") return "success";
  if (probe.status === "degraded") return "warning";
  return "destructive";
}

function EndpointTable({ result }: { result: MonitoringResult }) {
  const probes = result.snapshot?.results ?? [];
  return (
    <div
      className="overflow-hidden rounded-xl border border-card-border bg-card"
      data-testid="monitoring-endpoints"
    >
      <div className="border-b border-card-border px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Endpoints
      </div>
      <ul className="divide-y divide-card-border">
        {probes.map((probe) => (
          <li
            key={probe.id}
            data-testid={`monitoring-row-${probe.id}`}
            title={probe.error ?? undefined}
            className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:grid-cols-[minmax(0,2fr)_auto_auto_auto_auto_auto_auto]"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {probe.label}
              </div>
              <div className="truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {probe.method} {probe.path}
              </div>
            </div>
            <StatusPill
              status={probe.status}
              testId={`monitoring-pill-${probe.id}`}
            />
            <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:block">
              {formatStatusCode(probe.statusCode)}
            </span>
            <span
              className="hidden font-mono text-xs tabular-nums sm:block"
              data-testid={`monitoring-latency-${probe.id}`}
            >
              {formatLatency(probe.latencyMs)}
            </span>
            <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:block">
              {formatBytes(probe.payloadBytes)}
            </span>
            <span className="hidden font-mono text-xs tabular-nums text-muted-foreground sm:block">
              {formatRelativeTime(probe.completedAt)}
            </span>
            <div className="hidden justify-end sm:flex">
              <Sparkline
                samples={result.history[probe.id] ?? []}
                tone={probeTone(probe)}
                testId={`monitoring-sparkline-${probe.id}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatRate(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function ProviderCard({ provider }: { provider: ProviderHealth }) {
  return (
    <div
      className="min-w-0 rounded-xl border border-card-border bg-card p-3"
      data-testid={`monitoring-provider-${provider.name}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-sm font-bold tracking-wider">
          {provider.name}
        </span>
        <div className="flex shrink-0 items-center gap-1.5">
          {!provider.available && (
            <span className="rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              SKIPPED
            </span>
          )}
          <StatusPill status={provider.status} />
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px]">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Requests</dt>
          <dd className="tabular-nums">{provider.requests}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Success</dt>
          <dd className="tabular-nums">
            {provider.requests > 0
              ? formatRate(provider.successes / provider.requests)
              : "--"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Errors</dt>
          <dd className="tabular-nums">{formatRate(provider.errorRate)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Consec. fails</dt>
          <dd className="tabular-nums">{provider.consecutiveFailures}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Avg latency</dt>
          <dd className="tabular-nums">{formatLatency(provider.avgLatencyMs)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">p95 latency</dt>
          <dd className="tabular-nums">
            {provider.p95LatencyMs != null
              ? formatLatency(provider.p95LatencyMs)
              : "--"}
          </dd>
        </div>
      </dl>
      {provider.lastError && (
        <p className="mt-2 truncate font-mono text-[10px] text-destructive" title={provider.lastError}>
          {provider.lastError}
        </p>
      )}
    </div>
  );
}

function ProvidersPanel({
  providers,
}: {
  providers: ProviderHealth[] | null;
}) {
  if (providers === null) return null;
  return (
    <div data-testid="monitoring-providers">
      <div className="mb-3 font-mono text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Provider failover
      </div>
      {providers.length === 0 ? (
        <p className="rounded-xl border border-card-border bg-card p-4 text-sm text-muted-foreground">
          No provider data yet.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {providers.map((provider) => (
            <ProviderCard key={provider.name} provider={provider} />
          ))}
        </div>
      )}
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-xl border border-card-border bg-card p-10 text-center"
      data-testid="monitoring-loading"
    >
      <Activity className="h-6 w-6 animate-pulse text-muted-foreground" aria-hidden />
      <p className="font-mono text-sm uppercase tracking-widest text-muted-foreground">
        Gathering telemetry…
      </p>
    </div>
  );
}

/**
 * The monitoring deep module: overall status, endpoint probe table, and the
 * per-provider failover panel. Given a `MonitoringResult` it renders every
 * state — loading, live, paused — the page just calls the hook and hands the
 * result over.
 */
export function MonitoringView({ result }: { result: MonitoringResult }) {
  const { snapshot, summary, isPolling, isPaused, togglePaused, refresh } =
    result;

  if (!result.hasEverRun) {
    return <LoadingState />;
  }

  const overall = summary.overall === "pending" ? "ok" : summary.overall;
  const isLive = !isPaused;

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border border-card-border bg-card p-4"
        data-testid="monitoring-summary"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <StatusPill
              status={overall}
              pulse={isLive}
              testId="monitoring-overall"
            />
            <span
              data-testid="monitoring-live"
              className={cn(
                "font-mono text-xs font-bold uppercase tracking-widest",
                isLive ? "text-success" : "text-muted-foreground",
              )}
            >
              {isLive ? "LIVE" : "PAUSED"}
            </span>
            <span className="hidden font-mono text-xs text-muted-foreground sm:block">
              polling every {Math.round(MONITOR_POLL_INTERVAL_MS / 1000)}s
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={togglePaused}
              data-testid="monitoring-pause"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-card-border px-3 font-mono text-xs font-semibold uppercase tracking-widest"
            >
              {isPaused ? (
                <Play className="h-3.5 w-3.5" aria-hidden />
              ) : (
                <Pause className="h-3.5 w-3.5" aria-hidden />
              )}
              {isPaused ? "Resume" : "Pause"}
            </button>
            <button
              type="button"
              onClick={refresh}
              disabled={isPolling}
              data-testid="monitoring-refresh"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-card-border px-3 font-mono text-xs font-semibold uppercase tracking-widest disabled:opacity-50"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isPolling && "animate-spin")}
                aria-hidden
              />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat
            label="Success rate"
            value={`${summary.ok}/${summary.total}`}
            testId="monitoring-success-rate"
          />
          <Stat
            label="Avg latency"
            value={formatLatency(summary.avgLatencyMs ?? 0)}
          />
          <Stat
            label="Max latency"
            value={formatLatency(summary.maxLatencyMs ?? 0)}
          />
          <Stat
            label="Last checked"
            value={
              snapshot
                ? formatRelativeTime(snapshot.generatedAt)
                : undefined
            }
            testId="monitoring-last-checked"
          />
          <Stat
            label="Health"
            value={snapshot?.health?.status}
            testId="monitoring-health"
          />
          <Stat
            label="Version"
            value={snapshot?.health?.version}
            testId="monitoring-version"
          />
          <Stat
            label="Uptime"
            value={formatUptime(snapshot?.health?.uptime_seconds ?? 0)}
            testId="monitoring-uptime"
          />
          <Stat
            label="Redis"
            value={snapshot?.health?.redis}
            testId="monitoring-redis"
            tone={
              snapshot?.health?.redis === "up"
                ? "success"
                : snapshot?.health?.redis === "down"
                  ? "destructive"
                  : "muted"
            }
          />
          <Stat
            label="Catalog"
            value={
              snapshot?.catalogCount != null
                ? `${snapshot.catalogCount.toLocaleString()} trains`
                : undefined
            }
            testId="monitoring-catalog"
          />
        </div>
      </div>

      {snapshot && <EndpointTable result={result} />}

      <ProvidersPanel providers={snapshot?.providers ?? null} />

      {summary.down > 0 && (
        <p
          className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          data-testid="monitoring-outage"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {summary.down} of {summary.total} endpoints unreachable.
        </p>
      )}
    </div>
  );
}

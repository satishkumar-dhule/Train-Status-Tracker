import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type {
  MonitoringProbes,
  ProbeId,
  ProbeResult,
  ProviderHealth,
} from "../lib/api-monitoring";
import type { MonitoringResult } from "../hooks/use-api-monitoring";
import { MonitoringView } from "./monitoring-view";

function makeProbe(overrides: Partial<ProbeResult>): ProbeResult {
  return {
    id: "health",
    label: "Health",
    method: "GET",
    path: "/api/healthz",
    statusCode: 200,
    latencyMs: 12,
    payloadBytes: 120,
    status: "ok",
    error: null,
    completedAt: 1_700_000_000_000,
    ...overrides,
  };
}

const PROBE_IDS: ProbeId[] = [
  "health",
  "catalog",
  "search",
  "runs",
  "status",
  "providers",
];

function makeSnapshot(
  results: ProbeResult[],
  overrides: Partial<MonitoringProbes> = {},
): MonitoringProbes {
  return {
    results,
    health: {
      status: "ok",
      redis: "up",
      uptime_seconds: 3_661,
      version: "0.1.0",
      timestamp: "2026-08-09T00:00:00.000Z",
    },
    catalogCount: 14_032,
    providers: [
      {
        name: "paytm",
        requests: 120,
        successes: 115,
        notFound: 2,
        upstreamErrors: 3,
        timeouts: 1,
        consecutiveFailures: 0,
        errorRate: 0.025,
        avgLatencyMs: 240,
        p95LatencyMs: 520,
        status: "ok",
        available: true,
        lastSuccessAt: "2026-08-09T00:00:00.000Z",
        lastError: null,
        lastErrorAt: null,
      },
    ],
    generatedAt: 1_700_000_005_000,
    ...overrides,
  };
}

function allOkSnapshot(): MonitoringProbes {
  return makeSnapshot(
    PROBE_IDS.map((id, index) =>
      makeProbe({
        id,
        label: id,
        latencyMs: 10 + index,
      }),
    ),
  );
}

function makeResult(overrides: Partial<MonitoringResult>): MonitoringResult {
  return {
    snapshot: allOkSnapshot(),
    summary: { overall: "ok", ok: 6, degraded: 0, down: 0, total: 6, successRate: 1, avgLatencyMs: 13, maxLatencyMs: 15 },
    history: {
      health: [10, 11, 12],
      catalog: [11, 12, 13],
      search: [12, 13, 14],
      runs: [13, 14, 15],
      status: [14, 15, 16],
      providers: [15, 16, 17],
    },
    isPolling: false,
    isPaused: false,
    hasEverRun: true,
    togglePaused: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

describe("MonitoringView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the loading panel before the first cycle completes", () => {
    render(<MonitoringView result={makeResult({ hasEverRun: false, snapshot: null })} />);
    expect(screen.getByTestId("monitoring-loading")).toBeInTheDocument();
  });

  it("renders the overall OK pill and all six endpoint rows", () => {
    render(<MonitoringView result={makeResult({})} />);

    expect(screen.getByTestId("monitoring-overall")).toHaveTextContent("OK");
    for (const id of PROBE_IDS) {
      expect(screen.getByTestId(`monitoring-row-${id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`monitoring-pill-${id}`)).toHaveTextContent("OK");
    }
  });

  it("shows DEGRADED overall when a probe is degraded", () => {
    const snapshot = makeSnapshot([
      ...PROBE_IDS.filter((id) => id !== "search").map((id, index) =>
        makeProbe({ id, latencyMs: 10 + index }),
      ),
      makeProbe({ id: "search", status: "degraded", statusCode: 400 }),
    ]);
    render(
      <MonitoringView
        result={makeResult({
          snapshot,
          summary: {
            overall: "degraded", ok: 5, degraded: 1, down: 0, total: 6,
            successRate: 5 / 6, avgLatencyMs: 10, maxLatencyMs: 12,
          },
        })}
      />,
    );

    expect(screen.getByTestId("monitoring-overall")).toHaveTextContent("DEGRADED");
    expect(screen.getByTestId("monitoring-pill-search")).toHaveTextContent(
      "DEGRADED",
    );
  });

  it("shows DOWN overall and an outage banner when a probe is down", () => {
    const snapshot = makeSnapshot([
      ...PROBE_IDS.filter((id) => id !== "runs").map((id, index) =>
        makeProbe({ id, latencyMs: 10 + index }),
      ),
      makeProbe({ id: "runs", status: "down", statusCode: null, error: "Network or timeout error" }),
    ]);
    render(
      <MonitoringView
        result={makeResult({
          snapshot,
          summary: {
            overall: "down", ok: 5, degraded: 0, down: 1, total: 6,
            successRate: 5 / 6, avgLatencyMs: 10, maxLatencyMs: 12,
          },
        })}
      />,
    );

    expect(screen.getByTestId("monitoring-overall")).toHaveTextContent("DOWN");
    expect(screen.getByTestId("monitoring-outage")).toHaveTextContent(
      "1 of 6 endpoints unreachable",
    );
    expect(screen.getByTestId("monitoring-row-runs")).toHaveAttribute(
      "title",
      "Network or timeout error",
    );
  });

  it("renders the health, version, uptime, redis, catalog, and success-rate stats", () => {
    render(<MonitoringView result={makeResult({})} />);

    expect(screen.getByTestId("monitoring-health")).toHaveTextContent("ok");
    expect(screen.getByTestId("monitoring-version")).toHaveTextContent("0.1.0");
    expect(screen.getByTestId("monitoring-uptime")).toHaveTextContent("1h 1m");
    expect(screen.getByTestId("monitoring-redis")).toHaveTextContent("up");
    expect(screen.getByTestId("monitoring-catalog")).toHaveTextContent(
      "14,032 trains",
    );
    expect(screen.getByTestId("monitoring-success-rate")).toHaveTextContent("6/6");
  });

  it("renders provider cards including skipped providers and last errors", () => {
    const failing: ProviderHealth = {
      name: "goibibo",
      requests: 40,
      successes: 20,
      notFound: 0,
      upstreamErrors: 20,
      timeouts: 8,
      consecutiveFailures: 4,
      errorRate: 0.5,
      avgLatencyMs: 900,
      p95LatencyMs: 1500,
      status: "down",
      available: false,
      lastSuccessAt: null,
      lastError: "ECONNREFUSED upstream",
      lastErrorAt: "2026-08-09T00:00:00.000Z",
    };
    const snapshot = makeSnapshot(allOkSnapshot().results, {
      providers: [allOkSnapshot().providers![0], failing],
    });
    render(<MonitoringView result={makeResult({ snapshot })} />);

    expect(screen.getByTestId("monitoring-providers")).toBeInTheDocument();
    expect(screen.getByTestId("monitoring-provider-paytm")).toBeInTheDocument();
    expect(screen.getByTestId("monitoring-provider-goibibo")).toHaveTextContent(
      "SKIPPED",
    );
    expect(screen.getByTestId("monitoring-provider-goibibo")).toHaveTextContent(
      "ECONNREFUSED upstream",
    );
  });

  it("renders an empty-provider notice when the API reports none", () => {
    const snapshot = makeSnapshot(allOkSnapshot().results, { providers: [] });
    render(<MonitoringView result={makeResult({ snapshot })} />);

    expect(screen.getByText("No provider data yet.")).toBeInTheDocument();
  });

  it("renders sparklines for probes with history samples", () => {
    render(<MonitoringView result={makeResult({})} />);

    for (const id of PROBE_IDS) {
      expect(screen.getByTestId(`monitoring-sparkline-${id}`)).toBeInTheDocument();
    }
  });

  it("refresh and pause buttons drive the hook callbacks", async () => {
    const user = userEvent.setup();
    const result = makeResult({});
    render(<MonitoringView result={result} />);

    await user.click(screen.getByTestId("monitoring-refresh"));
    expect(result.refresh).toHaveBeenCalledTimes(1);

    await user.click(screen.getByTestId("monitoring-pause"));
    expect(result.togglePaused).toHaveBeenCalledTimes(1);
  });

  it("shows a paused live badge when polling is paused", () => {
    render(
      <MonitoringView
        result={makeResult({ isPaused: true, isPolling: false })}
      />,
    );
    expect(screen.getByTestId("monitoring-live")).toHaveTextContent("PAUSED");
    expect(screen.getByTestId("monitoring-pause")).toHaveTextContent("Resume");
  });
});

import "@testing-library/jest-dom/vitest";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  MonitoringProbes,
  ProbeId,
  ProbeResult,
  ProbeStatus,
} from "../lib/api-monitoring";
import { MONITOR_POLL_INTERVAL_MS } from "../lib/api-monitoring";
import { useApiMonitoring } from "./use-api-monitoring";

const mocks = vi.hoisted(() => ({
  runProbes: vi.fn(),
}));

vi.mock("../lib/api-monitoring", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/api-monitoring")>();
  return {
    ...actual,
    runProbes: mocks.runProbes,
  };
});

interface Deferred {
  promise: Promise<MonitoringProbes>;
  resolve: (value: MonitoringProbes) => void;
}

function makeDeferred(): Deferred {
  let resolve!: (value: MonitoringProbes) => void;
  const promise = new Promise<MonitoringProbes>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let deferreds: Deferred[] = [];

function makeResult(
  id: ProbeId,
  latencyMs = 10,
  status: ProbeStatus = "ok",
): ProbeResult {
  return {
    id,
    label: id,
    method: "GET",
    path: `/api/${id}`,
    statusCode: status === "ok" ? 200 : 500,
    latencyMs,
    payloadBytes: 0,
    status,
    error: null,
    completedAt: Date.now(),
  };
}

function makeSnapshot(results: ProbeResult[]): MonitoringProbes {
  return {
    results,
    health: null,
    catalogCount: null,
    providers: null,
    generatedAt: Date.now(),
  };
}

/** Resolve the `index`-th runProbes call and flush the resulting state updates. */
async function resolveCycle(index: number, snapshot: MonitoringProbes) {
  await act(async () => {
    deferreds[index].resolve(snapshot);
  });
}

async function advancePolling(ms = MONITOR_POLL_INTERVAL_MS) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  deferreds = [];
  mocks.runProbes.mockReset();
  mocks.runProbes.mockImplementation(() => {
    const deferred = makeDeferred();
    deferreds.push(deferred);
    return deferred.promise;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useApiMonitoring", () => {
  it("runs a probe cycle immediately on mount and exposes the snapshot", async () => {
    const { result } = renderHook(() => useApiMonitoring());

    expect(mocks.runProbes).toHaveBeenCalledTimes(1);
    expect(result.current.snapshot).toBeNull();
    expect(result.current.isPolling).toBe(true);
    expect(result.current.hasEverRun).toBe(false);
    expect(result.current.summary.overall).toBe("pending");

    await resolveCycle(0, makeSnapshot([makeResult("health", 12)]));

    expect(result.current.snapshot?.results).toEqual([
      makeResult("health", 12),
    ]);
    expect(result.current.isPolling).toBe(false);
    expect(result.current.hasEverRun).toBe(true);
    expect(result.current.history.health).toEqual([12]);
  });

  it("runs subsequent cycles on the poll interval", async () => {
    const { result } = renderHook(() => useApiMonitoring());
    await resolveCycle(0, makeSnapshot([makeResult("health")]));
    expect(mocks.runProbes).toHaveBeenCalledTimes(1);

    await advancePolling();

    expect(mocks.runProbes).toHaveBeenCalledTimes(2);
    expect(result.current.isPolling).toBe(true);

    await resolveCycle(1, makeSnapshot([makeResult("health")]));
    expect(result.current.isPolling).toBe(false);
  });

  it("never overlaps: a tick mid-cycle does not start a second runProbes", async () => {
    const { result } = renderHook(() => useApiMonitoring());
    expect(mocks.runProbes).toHaveBeenCalledTimes(1);

    await advancePolling();
    expect(mocks.runProbes).toHaveBeenCalledTimes(1);

    await resolveCycle(0, makeSnapshot([makeResult("health")]));
    expect(mocks.runProbes).toHaveBeenCalledTimes(1);

    await advancePolling();
    expect(mocks.runProbes).toHaveBeenCalledTimes(2);

    await resolveCycle(1, makeSnapshot([makeResult("health")]));
  });

  it("togglePaused stops scheduling and resuming restarts it", async () => {
    const { result } = renderHook(() => useApiMonitoring());
    await resolveCycle(0, makeSnapshot([makeResult("health")]));

    act(() => result.current.togglePaused());
    expect(result.current.isPaused).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MONITOR_POLL_INTERVAL_MS * 3);
    });
    expect(mocks.runProbes).toHaveBeenCalledTimes(1);

    act(() => result.current.togglePaused());
    expect(result.current.isPaused).toBe(false);

    await advancePolling();
    expect(mocks.runProbes).toHaveBeenCalledTimes(2);

    await resolveCycle(1, makeSnapshot([makeResult("health")]));
  });

  it("refresh forces a cycle immediately even while paused", async () => {
    const { result } = renderHook(() => useApiMonitoring());
    await resolveCycle(0, makeSnapshot([makeResult("health")]));

    act(() => result.current.togglePaused());
    act(() => result.current.refresh());

    expect(mocks.runProbes).toHaveBeenCalledTimes(2);
    await resolveCycle(1, makeSnapshot([makeResult("health")]));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MONITOR_POLL_INTERVAL_MS * 3);
    });
    expect(mocks.runProbes).toHaveBeenCalledTimes(2);
  });

  it("refresh resets the poll timer so the next tick is a full interval away", async () => {
    const { result } = renderHook(() => useApiMonitoring());
    await resolveCycle(0, makeSnapshot([makeResult("health")]));

    await advancePolling(MONITOR_POLL_INTERVAL_MS / 2);
    act(() => result.current.refresh());
    expect(mocks.runProbes).toHaveBeenCalledTimes(2);
    await resolveCycle(1, makeSnapshot([makeResult("health")]));

    await advancePolling(MONITOR_POLL_INTERVAL_MS / 2);
    expect(mocks.runProbes).toHaveBeenCalledTimes(2);

    await advancePolling(MONITOR_POLL_INTERVAL_MS / 2);
    expect(mocks.runProbes).toHaveBeenCalledTimes(3);

    await resolveCycle(2, makeSnapshot([makeResult("health")]));
  });

  it("accumulates latency samples per probe and caps at 40", async () => {
    const { result } = renderHook(() => useApiMonitoring());
    const latencies = Array.from({ length: 45 }, (_, i) => i + 1);

    for (let i = 0; i < 45; i++) {
      await resolveCycle(
        i,
        makeSnapshot([
          makeResult("health", latencies[i]),
          makeResult("status", latencies[i] * 2),
        ]),
      );
      await advancePolling();
    }

    expect(result.current.history.health).toHaveLength(40);
    expect(result.current.history.health).toEqual(latencies.slice(5));
    expect(result.current.history.status).toEqual(
      latencies.slice(5).map((ms) => ms * 2),
    );
  });

  it("summary reflects the latest snapshot results", async () => {
    const { result } = renderHook(() => useApiMonitoring());
    expect(result.current.summary.overall).toBe("pending");

    await resolveCycle(
      0,
      makeSnapshot([
        makeResult("health", 10),
        makeResult("catalog", 20),
        makeResult("search", 30),
      ]),
    );

    expect(result.current.summary.overall).toBe("ok");
    expect(result.current.summary.total).toBe(3);
    expect(result.current.summary.ok).toBe(3);
    expect(result.current.summary.degraded).toBe(0);
    expect(result.current.summary.down).toBe(0);
    expect(result.current.summary.avgLatencyMs).toBe(20);
    expect(result.current.summary.maxLatencyMs).toBe(30);
  });

  it("keeps polling after a cycle rejects, without recording a snapshot", async () => {
    mocks.runProbes.mockReset();
    mocks.runProbes
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementation(() => {
        const deferred = makeDeferred();
        deferreds.push(deferred);
        return deferred.promise;
      });

    const { result } = renderHook(() => useApiMonitoring());
    expect(mocks.runProbes).toHaveBeenCalledTimes(1);

    await act(async () => {});
    expect(result.current.snapshot).toBeNull();
    expect(result.current.isPolling).toBe(false);
    expect(result.current.hasEverRun).toBe(false);

    await advancePolling();
    expect(mocks.runProbes).toHaveBeenCalledTimes(2);

    await resolveCycle(0, makeSnapshot([makeResult("health")]));
    expect(result.current.snapshot?.results).toHaveLength(1);
    expect(result.current.hasEverRun).toBe(true);
  });
});

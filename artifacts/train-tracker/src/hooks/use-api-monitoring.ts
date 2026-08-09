import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MonitoringProbes,
  MonitoringSummary,
  ProbeId,
  ProbeResult,
} from "../lib/api-monitoring";
import {
  MONITOR_POLL_INTERVAL_MS,
  runProbes,
  summarizeProbes,
} from "../lib/api-monitoring";

/** Latency samples kept per probe; older samples are dropped past this. */
const HISTORY_LIMIT = 40;

export interface MonitoringResult {
  /** Latest completed probe cycle, or null before the first one finishes. */
  snapshot: MonitoringProbes | null;
  /** summarizeProbes(snapshot?.results ?? []) — overall = "pending" before first cycle. */
  summary: MonitoringSummary;
  /** Per-probe latency samples, oldest → newest, capped at 40 per probe. */
  history: Record<ProbeId, number[]>;
  /** True while a probe cycle is currently in flight. */
  isPolling: boolean;
  /** True while real-time polling is paused. */
  isPaused: boolean;
  /** True once at least one cycle has completed. */
  hasEverRun: boolean;
  togglePaused: () => void;
  refresh: () => void;
}

function appendLatencySamples(
  prev: Record<ProbeId, number[]>,
  results: readonly ProbeResult[],
): Record<ProbeId, number[]> {
  const next = { ...prev };
  for (const result of results) {
    const samples = next[result.id] ?? [];
    next[result.id] = [...samples, result.latencyMs].slice(-HISTORY_LIMIT);
  }
  return next;
}

export function useApiMonitoring(): MonitoringResult {
  const [snapshot, setSnapshot] = useState<MonitoringProbes | null>(null);
  const [history, setHistory] = useState<Record<ProbeId, number[]>>(
    {} as Record<ProbeId, number[]>,
  );
  const [isPolling, setIsPolling] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [hasEverRun, setHasEverRun] = useState(false);
  // Bumped by refresh() so the polling effect re-arms its timer a full
  // interval out.
  const [timerReset, setTimerReset] = useState(0);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  const timeoutIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runCycle = useCallback(async () => {
    // Never start a second cycle while one is still in flight.
    if (!mountedRef.current || inFlightRef.current) return;
    inFlightRef.current = true;
    setIsPolling(true);
    try {
      const next = await runProbes();
      if (!mountedRef.current) return;
      setSnapshot(next);
      setHistory((prev) => appendLatencySamples(prev, next.results));
      setHasEverRun(true);
    } catch {
      // runProbes already catches per-probe errors; keep the last snapshot.
    } finally {
      inFlightRef.current = false;
      if (mountedRef.current) setIsPolling(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    runCycle();
    return () => {
      mountedRef.current = false;
    };
  }, [runCycle]);

  useEffect(() => {
    if (isPaused) return;
    let cancelled = false;
    const scheduleNext = () => {
      if (cancelled || isPaused) return;
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
      }
      timeoutIdRef.current = setTimeout(() => {
        if (cancelled || isPaused) return;
        if (inFlightRef.current) {
          // A tick that lands mid-cycle is skipped and pushed a full
          // interval out instead of starting a concurrent runProbes.
          scheduleNext();
          return;
        }
        runCycle().then(scheduleNext);
      }, MONITOR_POLL_INTERVAL_MS);
    };
    scheduleNext();
    return () => {
      cancelled = true;
      if (timeoutIdRef.current !== null) {
        clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, [isPaused, timerReset, runCycle]);

  const togglePaused = useCallback(() => {
    setIsPaused((prev) => !prev);
  }, []);

  const refresh = useCallback(() => {
    // Forces a cycle now regardless of pause state and re-arms the poll
    // timer so the next scheduled tick is a full interval away.
    setTimerReset((n) => n + 1);
    runCycle();
  }, [runCycle]);

  const summary = summarizeProbes(snapshot?.results ?? []);

  return {
    snapshot,
    summary,
    history,
    isPolling,
    isPaused,
    hasEverRun,
    togglePaused,
    refresh,
  };
}

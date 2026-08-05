import { toApiDate } from "@workspace/trains-data";
import {
  fetchPaytmTrainStatus,
  PaytmTrainNotFoundError,
  PaytmUpstreamError,
} from "./paytm-client";

/**
 * Probe-based run-date derivation for a single train.
 *
 * Trains don't run every calendar day, so a fixed ±N-day window around today
 * is mostly wrong. Instead we probe the data provider across the trailing 3
 * weeks (today-20 .. today) and infer the train's running-weekday pattern,
 * then return the last 3 run dates up to today plus the next upcoming run.
 * The weekdays, not the raw dates, are the durable signal — a single probe
 * failing (upstream error) or a one-off cancellation must not drop a weekday.
 */

/** Days to look back when probing (inclusive of today): a 3-week window. */
export const RUN_WINDOW_DAYS = 20;

/** Default cap on concurrent upstream probes. */
const DEFAULT_PROBE_CONCURRENCY = 6;

export interface ProbeTrainRunsOptions {
  fetchImpl?: typeof fetch;
  /** Injectable clock for tests. Defaults to `new Date()`. */
  now?: Date;
  /** Days back to probe, inclusive of today. Defaults to {@link RUN_WINDOW_DAYS}. */
  windowDays?: number;
  /** Max concurrent upstream probes. Defaults to 6. */
  concurrency?: number;
}

export interface RunWeekdaysResult {
  /**
   * Day-of-week indices (0 = Sunday .. 6 = Saturday) the train plausibly runs
   * on. A weekday is trusted only when it ran on a majority of its probes
   * (more "run" than "norun" outcomes) — a single spurious success from the
   * provider on a non-running date must not pollute the pattern.
   */
  weekdays: number[];
  /** Probe dates (YYYYMMDD, ascending) the train actually ran on. */
  observedRuns: string[];
  /** Number of probes that failed with an upstream error (excluded from both). */
  upstreamFailures: number;
}

type ProbeOutcome = "run" | "norun" | "error";

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear().toString();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/** 'YYYY-MM-DD' for each of the last `windowDays+1` days up to and including today, ascending. */
export function buildProbeDates(
  windowDays: number,
  now: Date,
): string[] {
  const today = startOfDay(now);
  const dates: string[] = [];
  for (let offset = windowDays; offset >= 0; offset--) {
    dates.push(
      toApiDate(
        toLocalDateKey(
          new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset),
        ),
      ),
    );
  }
  return dates;
}

/**
 * Map `items` through an async `fn` with at most `limit` concurrent calls,
 * preserving input order. `limit` is floored at 1.
 */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const safeLimit = Math.max(1, Math.floor(limit));
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(safeLimit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        results[index] = await fn(items[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Probe the last 3 weeks of departure dates for `trainNumber` and derive its
 * running-weekday pattern. Any thrown error is treated as an unknown probe
 * (counted in `upstreamFailures`) rather than failing the whole discovery.
 *
 * Each weekday is probed ~3 times across the window; it is only counted as a
 * running day when it returned "run" on a majority of its probes, so an
 * occasional provider success on a day the train does not run does not mark
 * that weekday as running.
 */
export async function probeTrainRuns(
  trainNumber: string,
  options: ProbeTrainRunsOptions = {},
): Promise<RunWeekdaysResult> {
  const windowDays = options.windowDays ?? RUN_WINDOW_DAYS;
  const now = options.now ?? new Date();
  const concurrency = options.concurrency ?? DEFAULT_PROBE_CONCURRENCY;
  const fetchImpl = options.fetchImpl;

  const dates = buildProbeDates(windowDays, now);

  const outcomes = await mapLimited(dates, concurrency, async (date) => {
    try {
      await fetchPaytmTrainStatus(trainNumber, date, { fetchImpl });
      return { date, outcome: "run" as const };
    } catch (err) {
      if (err instanceof PaytmTrainNotFoundError) {
        return { date, outcome: "norun" as const };
      }
      if (err instanceof PaytmUpstreamError) {
        return { date, outcome: "error" as const };
      }
      return { date, outcome: "error" as const };
    }
  });

  const runCounts = new Map<number, number>();
  const norunCounts = new Map<number, number>();
  const observedRuns: string[] = [];
  let upstreamFailures = 0;

  const weekdayOf = (apiDate: string): number =>
    new Date(
      Number(apiDate.slice(0, 4)),
      Number(apiDate.slice(4, 6)) - 1,
      Number(apiDate.slice(6, 8)),
    ).getDay();

  for (const { date, outcome } of outcomes) {
    if (outcome === "run") {
      observedRuns.push(date);
      const weekday = weekdayOf(date);
      runCounts.set(weekday, (runCounts.get(weekday) ?? 0) + 1);
    } else if (outcome === "norun") {
      const weekday = weekdayOf(date);
      norunCounts.set(weekday, (norunCounts.get(weekday) ?? 0) + 1);
    } else {
      upstreamFailures += 1;
    }
  }

  const weekdays: number[] = [];
  for (const [weekday, runs] of runCounts) {
    if (runs > (norunCounts.get(weekday) ?? 0)) {
      weekdays.push(weekday);
    }
  }

  weekdays.sort((a, b) => a - b);

  return { weekdays, observedRuns, upstreamFailures };
}

/**
 * The last 3 run dates (YYYYMMDD, ascending) up to today plus the next
 * upcoming run date, derived from the train's running-weekday pattern.
 * Returns an empty array when `weekdays` is empty.
 */
export function computeRunDates(
  weekdays: Iterable<number>,
  options: { now?: Date; windowDays?: number } = {},
): string[] {
  const windowDays = options.windowDays ?? RUN_WINDOW_DAYS;
  const now = options.now ?? new Date();
  const today = startOfDay(now);
  const runSet = new Set(weekdays);
  if (runSet.size === 0) return [];

  const past: string[] = [];
  for (let offset = windowDays; offset >= 0; offset--) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    if (runSet.has(date.getDay())) {
      past.push(toApiDate(toLocalDateKey(date)));
    }
  }
  const last3 = past.slice(-3);

  const next = nextRunDate(runSet, today);
  return next ? [...last3, next] : last3;
}

/** Earliest date (YYYYMMDD) after `today` whose weekday is in `runSet`, or null. */
function nextRunDate(runSet: Set<number>, today: Date): string | null {
  for (let offset = 1; ; offset++) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
    if (runSet.has(date.getDay())) {
      return toApiDate(toLocalDateKey(date));
    }
  }
}

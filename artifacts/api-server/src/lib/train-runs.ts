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
 * weeks (today-20 .. today) and derive the train's running-weekday pattern,
 * then return the last 3 run dates up to today plus the next upcoming run.
 *
 * Two signals are combined:
 *
 * 1. The provider's schedule note. On a day the train does NOT run the status
 *    API answers `success` with a fallback schedule and a message like "This
 *    train runs only on MON,FRI". That message is the authoritative running
 *    schedule, and parsing it beats inference — it survives days whose probes
 *    fail with "wrong start date" (real run days far enough in the past) or
 *    drop out of the majority vote.
 *
 * 2. Probe inference. When no schedule note is seen (e.g. a daily train),
 *    a weekday is trusted only when it ran on a majority of its probes, so a
 *    single spurious success on a non-running date cannot pollute the pattern.
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
   * Day-of-week indices (0 = Sunday .. 6 = Saturday) the train runs on. Taken
   * from the provider's "runs only on …" schedule note when one was seen,
   * otherwise inferred by majority vote among each weekday's probes.
   */
  weekdays: number[];
  /**
   * Weekday list decoded from the provider's schedule note, or null when no
   * note was seen (e.g. the train runs daily). When non-null it is the
   * authoritative source for {@link weekdays}.
   */
  scheduleWeekdays: number[] | null;
  /** Probe dates (YYYYMMDD, ascending) the train actually ran on. */
  observedRuns: string[];
  /** Number of probes that failed with an upstream error (excluded from both). */
  upstreamFailures: number;
}

type ProbeOutcome = "run" | "norun" | "error";

/** 3-letter day names the provider's schedule note uses (SUN..SAT). */
const WEEKDAY_TOKENS: Record<string, number> = {
  SUN: 0,
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
};

/**
 * Decode the provider's "This train runs only on MON,FRI" schedule note into
 * weekday indices (0 = Sunday .. 6 = Saturday). Returns null when the message
 * is not such a note or any token is unrecognized, so callers can fall back
 * to probe inference. Whitespace around day tokens is tolerated.
 */
export function parseScheduleWeekdays(
  message: string | null | undefined,
): number[] | null {
  if (!message) return null;
  const match = /runs only on\s+([A-Za-z,\s]+)/i.exec(message);
  if (!match) return null;
  const tokens = match[1]
    .split(",")
    .map((token) => token.trim().toUpperCase())
    .filter(Boolean);
  if (tokens.length === 0) return null;
  const weekdays = tokens.map((token) => WEEKDAY_TOKENS[token]);
  if (weekdays.some((weekday) => weekday === undefined)) return null;
  return [...new Set(weekdays)].sort((a, b) => a - b);
}

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
 * The provider answers `success` even on days the train does not run, carrying
 * a fallback schedule whose message reads "This train runs only on MON,FRI".
 * Such responses are classified as non-runs for that date, and the decoded
 * note becomes the authoritative weekday set. Absent a note, each weekday is
 * probed ~3 times across the window and only counts as a running day when it
 * returned a genuine "run" on a majority of its probes.
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

  const outcomes = await mapLimited(
    dates,
    concurrency,
    async (date): Promise<{ date: string; outcome: ProbeOutcome; scheduleWeekdays: number[] | null }> => {
      try {
        const payload = await fetchPaytmTrainStatus(trainNumber, date, {
          fetchImpl,
        });
        const scheduleWeekdays = parseScheduleWeekdays(
          payload.train_status_message,
        );
        if (scheduleWeekdays) {
          // The provider answered with the fallback schedule: the train does
          // not run on this date.
          return { date, outcome: "norun", scheduleWeekdays };
        }
        return { date, outcome: "run", scheduleWeekdays: null };
      } catch (err) {
        if (err instanceof PaytmTrainNotFoundError) {
          return { date, outcome: "norun", scheduleWeekdays: null };
        }
        if (err instanceof PaytmUpstreamError) {
          return { date, outcome: "error", scheduleWeekdays: null };
        }
        return { date, outcome: "error", scheduleWeekdays: null };
      }
    },
  );

  const runCounts = new Map<number, number>();
  const norunCounts = new Map<number, number>();
  const observedRuns: string[] = [];
  let scheduleWeekdays: number[] | null = null;
  let upstreamFailures = 0;

  const weekdayOf = (apiDate: string): number =>
    new Date(
      Number(apiDate.slice(0, 4)),
      Number(apiDate.slice(4, 6)) - 1,
      Number(apiDate.slice(6, 8)),
    ).getDay();

  for (const { date, outcome, scheduleWeekdays: parsedWeekdays } of outcomes) {
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
    if (parsedWeekdays) scheduleWeekdays ??= parsedWeekdays;
  }

  let weekdays: number[];
  if (scheduleWeekdays && scheduleWeekdays.length > 0) {
    weekdays = scheduleWeekdays;
  } else {
    weekdays = [];
    for (const [weekday, runs] of runCounts) {
      if (runs > (norunCounts.get(weekday) ?? 0)) {
        weekdays.push(weekday);
      }
    }
    weekdays.sort((a, b) => a - b);
  }

  return { weekdays, scheduleWeekdays, observedRuns, upstreamFailures };
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

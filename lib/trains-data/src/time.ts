/**
 * Time/date domain helpers shared by the API server and the web client.
 * Single source of truth for HH:MM parsing, delay math and date formatting.
 */

const SHORT_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Parse "HH:MM" time and return total minutes since midnight, or null. */
export function toMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const parts = t.split(":");
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

/**
 * Return signed delay (actual - scheduled) in minutes, accounting for day
 * roll-overs (e.g. scheduled 23:50, actual 00:10 → +20 min).
 */
export function calcDelay(
  scheduled: string | null | undefined,
  actual: string | null | undefined,
): number | null {
  const s = toMinutes(scheduled);
  const a = toMinutes(actual);
  if (s === null || a === null) return null;
  let diff = a - s;
  if (diff < -720) diff += 1440;
  if (diff > 720) diff -= 1440;
  return diff;
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear().toString();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' must be a real calendar date and >= today (local). */
export function isValidDepartureDate(dateISO: string, now?: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return false;
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return false;
  }
  const today = now ?? new Date();
  return dateISO >= toLocalDateKey(today);
}

/** 'YYYYMMDD' must be a real calendar date (server-side gate). */
export function isValidApiDate(apiDate: string): boolean {
  if (!/^\d{8}$/.test(apiDate)) return false;
  const y = Number(apiDate.slice(0, 4));
  const m = Number(apiDate.slice(4, 6));
  const d = Number(apiDate.slice(6, 8));
  const date = new Date(y, m - 1, d);
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d
  );
}

/** 'YYYY-MM-DD' -> 'YYYYMMDD' */
export function toApiDate(dateISO: string): string {
  return dateISO.replace(/-/g, "");
}

/** 'YYYYMMDD' -> 'YYYY-MM-DD'; returns the input unchanged when malformed. */
export function fromApiDate(apiDate: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(apiDate);
  if (!match) return apiDate;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

/**
 * Best default departure date (YYYYMMDD) for a train whose run dates are
 * known: today when the train runs today, otherwise the most recent past run,
 * otherwise the next upcoming run. Returns null when there are no runs.
 * `runs` must be sorted ascending.
 */
export function pickDefaultRunDate(runs: readonly string[], now?: Date): string | null {
  if (runs.length === 0) return null;
  const todayApi = toApiDate(getUpcomingDates(1, now)[0]);
  if (runs.includes(todayApi)) return todayApi;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (runs[i] < todayApi) return runs[i];
  }
  return runs.find((date) => date > todayApi) ?? null;
}

/** 'YYYY-MM-DD' for today .. today+count-1 (local time). */
export function getUpcomingDates(count: number, now?: Date): string[] {
  if (count <= 0) return [];
  const base = now ?? new Date();
  const dates: string[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(
      toLocalDateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)),
    );
  }
  return dates;
}

/** 'YYYY-MM-DD' for a window centered on today: today-before .. today+after (local time). */
export function getDateWindow(
  before: number,
  after: number,
  now?: Date,
): string[] {
  if (before < 0 || after < 0) return [];
  const base = now ?? new Date();
  const dates: string[] = [];
  for (let offset = -before; offset <= after; offset++) {
    dates.push(
      toLocalDateKey(
        new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset),
      ),
    );
  }
  return dates;
}

/** 'YYYY-MM-DD' -> '2 Aug'; returns the input unchanged when malformed. */
export function formatShortDate(dateISO: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateISO);
  if (!match) return dateISO;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return dateISO;
  return `${day} ${SHORT_MONTHS[month - 1]}`;
}

/** 510 -> "8h 30m"; 45 -> "45m"; 480 -> "8h" */
export function formatDuration(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes < 0) return "--";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

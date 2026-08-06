/**
 * Auto-refresh interval for train-status polling.
 *
 * The API server's in-process L1 cache serves a train/date for 30 seconds
 * (single-flighted), so a 30s poll hits the cache instead of an upstream —
 * polling on a shorter cadence would only waste the round trip. Parsed from
 * `VITE_AUTO_REFRESH_INTERVAL_MS` (milliseconds) with a 30-second default so
 * the consuming hook never reads `import.meta.env` directly and stays
 * unit-testable (same pattern as `lib/status-cache.ts`).
 */

import { parseEnvMs, readEnvMs } from "./env";

export const DEFAULT_AUTO_REFRESH_INTERVAL_MS = 30_000;

/** Vite env var name consumed by the SPA. */
export const AUTO_REFRESH_INTERVAL_ENV = "VITE_AUTO_REFRESH_INTERVAL_MS";

/**
 * Parses an auto-refresh interval in milliseconds. Returns `fallback` when
 * the value is missing, not a finite number, or non-positive.
 */
export function parseAutoRefreshIntervalMs(
  value: string | undefined,
  fallback: number = DEFAULT_AUTO_REFRESH_INTERVAL_MS,
): number {
  return parseEnvMs(value, fallback);
}

/**
 * Parses the interval from `import.meta.env` (or a provided env override).
 */
export function getAutoRefreshIntervalMs(
  env: Record<string, string | undefined> = import.meta.env,
): number {
  return readEnvMs(
    env,
    AUTO_REFRESH_INTERVAL_ENV,
    DEFAULT_AUTO_REFRESH_INTERVAL_MS,
  );
}

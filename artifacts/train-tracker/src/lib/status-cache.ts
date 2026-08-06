/**
 * Client-side cache TTL for train-status payloads.
 *
 * While cached data is younger than the TTL the app serves it from the
 * TanStack Query cache and never hits the backend API at all. Parsed from
 * `VITE_STATUS_CACHE_TTL_MS` (milliseconds) with a 5-minute default so the
 * consuming hook never reads `import.meta.env` directly and stays
 * unit-testable (same pattern as `lib/telemetry/config.ts`).
 */

export const DEFAULT_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;

/** Vite env var name consumed by the SPA. */
export const STATUS_CACHE_TTL_ENV = "VITE_STATUS_CACHE_TTL_MS";

/**
 * Extra time a cached entry outlives its freshness window before being
 * garbage-collected. Without this a fresh entry could be GC'd at the exact
 * moment it goes stale, turning a cache hit into a refetch.
 */
export const STATUS_CACHE_GC_BUFFER_MS = 60 * 1000;

import { parseEnvMs, readEnvMs } from "./env";

/**
 * Parses a cache TTL in milliseconds. Returns `fallback` when the value is
 * missing, not a finite number, or non-positive.
 */
export function parseStatusCacheTtlMs(
  value: string | undefined,
  fallback: number = DEFAULT_STATUS_CACHE_TTL_MS,
): number {
  return parseEnvMs(value, fallback);
}

/**
 * Parses the TTL from `import.meta.env` (or a provided env override).
 */
export function getStatusCacheTtlMs(
  env: Record<string, string | undefined> = import.meta.env,
): number {
  return readEnvMs(env, STATUS_CACHE_TTL_ENV, DEFAULT_STATUS_CACHE_TTL_MS);
}

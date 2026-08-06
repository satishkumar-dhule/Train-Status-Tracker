/**
 * Client-side env helpers (mirror of the API server's `src/lib/env.ts`).
 *
 * Every module that reads a Vite env var goes through these so a missing,
 * non-numeric, or negative value can never reach a consumer as a real number.
 * Kept free of `import.meta.env` references so each helper stays unit-testable.
 */

/**
 * Parses an env value as a positive millisecond integer. Returns `fallback`
 * when the value is missing, not a finite number, or non-positive.
 */
export function parseEnvMs(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  const ms = Number(value);
  if (Number.isNaN(ms) || ms <= 0) return fallback;
  return Math.round(ms);
}

/**
 * Reads a positive millisecond value from an env record (defaults to
 * `import.meta.env` at call sites).
 */
export function readEnvMs(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  return parseEnvMs(env[name], fallback);
}

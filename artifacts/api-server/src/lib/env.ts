/**
 * Reads a positive finite number from an environment mapping, returning
 * `fallback` when the variable is missing, empty, or unparseable. Keeps
 * per-route env parsing DRY and ensures an invalid value can never produce
 * `NaN`/`Infinity` at runtime (e.g. an unbounded cache TTL or rate limit).
 */
export function envPositiveNumber(
  env: Record<string, string | undefined>,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

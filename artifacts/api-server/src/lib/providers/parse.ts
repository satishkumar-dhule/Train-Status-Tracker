/**
 * Tiny, defensive value coercions used by every provider adapter. All upstream
 * payloads are treated as untrusted (ZTA): unknown shapes become null/false
 * rather than throwing, so a single malformed station never takes down the
 * whole response.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function toPositiveInt(value: unknown, fallback: number): number {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return fallback;
  const int = Math.trunc(parsed);
  return int > 0 ? int : fallback;
}

export function toNullableInt(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed === null) return null;
  const int = Math.trunc(parsed);
  return Number.isFinite(int) ? int : null;
}

/** `HH:MM` (or `HH:MM:SS`) slice of an ISO-ish timestamp, else null. */
export function isoTimeOfDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /T(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  return `${match[1]}:${match[2]}`;
}

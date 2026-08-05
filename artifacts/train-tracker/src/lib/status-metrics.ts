import { toMinutes } from "@workspace/trains-data";

/**
 * Minimal structural shape of a station entry from the running-status API.
 * Nullable fields mirror the generated `StationStatus` schema.
 */
export interface StatusStationLike {
  scheduled_arrival?: string | null;
  scheduled_departure?: string | null;
  actual_arrival?: string | null;
  actual_departure?: string | null;
  distance_from_source?: number | null;
  is_current: boolean;
  station_code: string;
  station_name: string;
  day: number;
  delay_minutes?: number | null;
  platform?: string | null;
  halt_minutes?: number | null;
  has_departed: boolean;
}

/** The station flagged as the train's current/last known position, or null. */
export function findCurrentStation(
  stations: readonly StatusStationLike[],
): StatusStationLike | null {
  return stations.find((station) => station.is_current) ?? null;
}

/** Percent of the journey completed, clamped to [0, 100]. */
export function computeProgressPercent(
  currentDistance: number | null,
  totalDistance: number | null,
): number | null {
  if (currentDistance === null || currentDistance === undefined) return null;
  if (totalDistance === null || totalDistance === undefined || totalDistance === 0) {
    return null;
  }
  const percent = (currentDistance / totalDistance) * 100;
  return Math.min(100, Math.max(0, percent));
}

/**
 * Minutes between the scheduled departure of the first station and the
 * scheduled arrival of the last. A negative diff means the arrival falls
 * after midnight (overnight run), so 24h are added.
 */
export function computeDurationMinutes(
  first: { scheduled_departure?: string | null },
  last: { scheduled_arrival?: string | null },
): number | null {
  const departure = toMinutes(first.scheduled_departure);
  const arrival = toMinutes(last.scheduled_arrival);
  if (departure === null || arrival === null) return null;
  const duration = arrival - departure;
  return duration < 0 ? duration + 1440 : duration;
}

function getErrorStatus(err: unknown): unknown {
  if (typeof err === "object" && err !== null) {
    return (err as { status?: unknown }).status;
  }
  return undefined;
}

/**
 * True when the thrown value is an API error carrying HTTP status 404
 * (e.g. the `ApiError` thrown by the generated client's customFetch).
 */
export function isTrainNotFoundError(err: unknown): boolean {
  return getErrorStatus(err) === 404;
}

/**
 * True when the thrown value is an API error carrying an HTTP 5xx status,
 * i.e. the data provider is unreachable. Network-level failures (which have
 * no `status`) are intentionally NOT matched here so consumers can report
 * them separately.
 */
export function isProviderUnreachableError(err: unknown): boolean {
  const status = getErrorStatus(err);
  return typeof status === "number" && status >= 500;
}

import { calcDelay, stripHtml } from "@workspace/trains-data";
import type { MappedStation, MappedStatus } from "../train-status-mapper";

/**
 * Normalized, provider-agnostic station row. Adapters translate their own
 * payloads into this shape; `toMappedStation`/`assembleMappedStatus` then turn
 * rows into the shared `MappedStatus` contract. This is the DRY seam that
 * keeps every upstream behind a single normalization path.
 */
export interface ProviderStationRow {
  station_code: string;
  station_name: string;
  scheduled_arrival: string | null;
  actual_arrival: string | null;
  scheduled_departure: string | null;
  actual_departure: string | null;
  /**
   * Explicit "already departed" flag, when the upstream tells us directly.
   * When absent it is inferred positionally (rows before the current station
   * are departed; the current station is departed once it has an actual
   * departure time), matching the legacy Paytm mapping.
   */
  has_departed?: boolean;
  delay_minutes?: number | null;
  distance?: number | null;
  platform?: string | null;
  halt_minutes?: number | null;
  day?: number;
}

export interface AssembleOptions {
  trainNumber: string;
  departureDate: string;
  knownTrain: { number: string; name: string } | null;
  /** Code of the station the train is currently at/past, if known. */
  currentStationCode?: string | null;
  statusMessage?: string | null;
  lastUpdated?: string | null;
}

/** 1-based serial of `currentStationCode` within the row list, else 0. */
export function computeRowCurrentSerial(
  rows: ProviderStationRow[],
  currentStationCode: string | null,
): number {
  if (!currentStationCode) return 0;
  const index = rows.findIndex(
    (row) => row.station_code === currentStationCode,
  );
  return index < 0 ? 0 : index + 1;
}

export function toMappedStation(
  row: ProviderStationRow,
  rowIndex: number,
  currentStationCode: string | null,
  currentSerial: number,
): MappedStation {
  const isCurrent = row.station_code === currentStationCode;
  const serial = rowIndex + 1;
  const hasDeparted =
    row.has_departed !== undefined
      ? row.has_departed
      : serial < currentSerial || (isCurrent && !!row.actual_departure);

  const scheduledArrival = row.scheduled_arrival;
  const scheduledDeparture = row.scheduled_departure;
  const distance = row.distance ?? null;

  return {
    station_code: row.station_code,
    station_name: row.station_name,
    scheduled_arrival: scheduledArrival,
    actual_arrival: row.actual_arrival,
    scheduled_departure: scheduledDeparture,
    actual_departure: row.actual_departure,
    delay_minutes:
      row.delay_minutes !== undefined && row.delay_minutes !== null
        ? row.delay_minutes
        : calcDelay(scheduledArrival, row.actual_arrival),
    distance_from_source:
      distance !== null && Number.isFinite(distance) ? distance : null,
    platform: row.platform ?? null,
    halt_minutes: row.halt_minutes ?? null,
    has_departed: hasDeparted,
    is_current: isCurrent,
    day: row.day ?? 1,
  };
}

/** Turn normalized rows into the shared `MappedStatus` contract. */
export function assembleMappedStatus(
  rows: ProviderStationRow[],
  options: AssembleOptions,
): MappedStatus {
  const currentStationCode = options.currentStationCode ?? null;
  const currentSerial = computeRowCurrentSerial(rows, currentStationCode);
  const stations = rows.map((row, index) =>
    toMappedStation(row, index, currentStationCode, currentSerial),
  );

  const currentStation = stations.find((station) => station.is_current);
  const firstStation = stations[0];
  const lastStation = stations[stations.length - 1];

  return {
    train_number: options.trainNumber,
    train_name: options.knownTrain
      ? options.knownTrain.name
      : `Train ${options.trainNumber}`,
    departure_date: options.departureDate,
    source_station_code: firstStation?.station_code ?? "",
    source_station_name: firstStation?.station_name ?? "",
    destination_station_code: lastStation?.station_code ?? "",
    destination_station_name: lastStation?.station_name ?? "",
    current_station_code: currentStationCode,
    current_station_name: currentStation?.station_name ?? null,
    current_delay_minutes: currentStation?.delay_minutes ?? null,
    status_message: stripHtml(options.statusMessage ?? null),
    last_updated: options.lastUpdated ?? null,
    provider: "",
    stations,
  };
}

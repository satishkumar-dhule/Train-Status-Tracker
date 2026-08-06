import type { MappedStatus } from "../train-status-mapper";
import { TrainStatusNotFoundError, TrainStatusUpstreamError } from "./errors";
import { fetchProviderStatus } from "./http";
import {
  assembleMappedStatus,
  type AssembleOptions,
  type ProviderStationRow,
} from "./normalize";
import {
  asNullableString,
  asString,
  isRecord,
  toFiniteNumber,
  toPositiveInt,
} from "./parse";
import type { KnownTrain, ProviderFetchOptions, TrainStatusProvider } from "./types";

const RAILYATRI_ENDPOINT = "https://livestatus.railyatri.in/api/v3/train_eta_data";

const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
};

/** YYYYMMDD -> 'YYYY-MM-DD', or null when not a valid 8-digit date. */
function toIsoDate(departureDate: string): string | null {
  if (!/^\d{8}$/.test(departureDate)) return null;
  return `${departureDate.slice(0, 4)}-${departureDate.slice(4, 6)}-${departureDate.slice(6, 8)}`;
}

/**
 * RailYatri's endpoint has no date parameter — it serves "today" (`start_day=0`)
 * or "yesterday" (`start_day=1`) relative to the server's local time. Reject
 * anything outside that window rather than silently returning a wrong date.
 */
export function computeStartDay(departureDate: string, now: Date): number {
  const iso = toIsoDate(departureDate);
  if (!iso) {
    throw new TrainStatusUpstreamError(
      "railyatri",
      `Unsupported date format: ${departureDate}`,
    );
  }
  const dateKey = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const today = dateKey(now);
  if (iso === today) return 0;
  const yesterday = dateKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1),
  );
  if (iso === yesterday) return 1;
  throw new TrainStatusUpstreamError(
    "railyatri",
    `RailYatri only supports today or yesterday (requested ${departureDate})`,
  );
}

function toRow(entry: Record<string, unknown>): ProviderStationRow {
  return {
    station_code: asString(entry.station_code),
    station_name: asString(entry.station_name),
    scheduled_arrival: asNullableString(entry.sta),
    actual_arrival: asNullableString(entry.eta),
    scheduled_departure: asNullableString(entry.std),
    actual_departure: asNullableString(entry.etd),
    delay_minutes:
      toFiniteNumber(entry.arrival_delay) ??
      toFiniteNumber(entry.departure_delay),
    distance: toFiniteNumber(entry.distance_from_source),
    platform:
      entry.platform_number !== undefined && entry.platform_number !== null
        ? String(entry.platform_number)
        : null,
    halt_minutes: null,
    day: toPositiveInt(entry.day, 1),
  };
}

/** Map an untrusted RailYatri livestatus body to a `MappedStatus`. */
export function mapRailYatriPayload(
  raw: unknown,
  options: AssembleOptions,
): MappedStatus {
  if (!isRecord(raw) || raw.success !== true) {
    throw new TrainStatusNotFoundError(
      "railyatri",
      "Train not found or no data",
    );
  }

  const previous = Array.isArray(raw.previous_stations)
    ? raw.previous_stations
    : [];
  const upcoming = Array.isArray(raw.upcoming_stations)
    ? raw.upcoming_stations
    : [];

  const rows: ProviderStationRow[] = [
    ...previous.filter(isRecord).map(toRow),
    {
      station_code: asString(raw.current_station_code),
      station_name: asString(raw.current_station_name),
      scheduled_arrival: asNullableString(raw.cur_stn_sta),
      actual_arrival: asNullableString(raw.eta),
      scheduled_departure: asNullableString(raw.cur_stn_std),
      actual_departure: asNullableString(raw.etd),
      // The current station is where the train is right now; `etd` is an
      // estimate, not proof it has left.
      has_departed: false,
      delay_minutes: toFiniteNumber(raw.delay),
      distance: toFiniteNumber(raw.distance_from_source),
      platform:
        raw.platform_number !== undefined && raw.platform_number !== null
          ? String(raw.platform_number)
          : null,
      halt_minutes: null,
      day: toPositiveInt(raw.day, 1),
    },
    ...upcoming.filter(isRecord).map(toRow),
  ];

  const currentStationCode = asNullableString(raw.current_station_code);

  const statusMessage =
    typeof raw.status_as_of === "string"
      ? raw.status_as_of
      : asNullableString(
          Array.isArray(raw.current_location_info) &&
            isRecord(raw.current_location_info[0])
            ? raw.current_location_info[0].message
            : null,
        );

  return assembleMappedStatus(rows, {
    ...options,
    currentStationCode,
    statusMessage,
    lastUpdated: asNullableString(raw.update_time),
  });
}

export class RailYatriProvider implements TrainStatusProvider {
  readonly name = "railyatri";
  readonly enabled = true;

  constructor(private readonly now: () => Date = () => new Date()) {}

  fetchTrainStatus(
    trainNumber: string,
    departureDate: string,
    options: ProviderFetchOptions,
    knownTrain: KnownTrain | null = null,
  ): Promise<MappedStatus> {
    let startDay: number;
    try {
      startDay = computeStartDay(departureDate, this.now());
    } catch (err) {
      return Promise.reject(err);
    }

    const url = new URL(
      `${RAILYATRI_ENDPOINT}/${trainNumber}/0.json`,
    );
    url.searchParams.set("start_day", String(startDay));

    return fetchProviderStatus(
      {
        provider: this.name,
        url: url.toString(),
        responseType: "json",
        headers: HEADERS,
        map: (raw) =>
          mapRailYatriPayload(raw, {
            trainNumber,
            departureDate,
            knownTrain,
          }),
      },
      options,
    );
  }
}

export function createRailYatriProvider(
  options: { now?: () => Date } = {},
): TrainStatusProvider {
  return new RailYatriProvider(options.now);
}

import type { MappedStatus } from "../train-status-mapper";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import { fetchProviderStatus } from "./http";
import {
  assembleMappedStatus,
  type AssembleOptions,
  type ProviderStationRow,
} from "./normalize";
import {
  asNullableString,
  asString,
  isoTimeOfDay,
  isRecord,
  toFiniteNumber,
  toPositiveInt,
} from "./parse";
import type { KnownTrain, ProviderFetchOptions, TrainStatusProvider } from "./types";

const RAILRADAR_ENDPOINT = "https://api.railradar.in/rest/v1/trains/status";

const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
};

/** YYYYMMDD -> DD-MM-YYYY, or null when not a valid 8-digit date. */
export function toRailRadarDate(departureDate: string): string | null {
  if (!/^\d{8}$/.test(departureDate)) return null;
  return `${departureDate.slice(6, 8)}-${departureDate.slice(4, 6)}-${departureDate.slice(0, 4)}`;
}

/** Map an untrusted RailRadar train status body to a `MappedStatus`. */
export function mapRailRadarPayload(
  raw: unknown,
  options: AssembleOptions,
): MappedStatus {
  if (!isRecord(raw)) {
    throw new TrainStatusUpstreamError("railradar", "Unexpected response shape");
  }
  if (raw.success !== true) {
    const error = isRecord(raw.error) ? raw.error : null;
    if (error && asString(error.code) === "NOT_FOUND") {
      throw new TrainStatusNotFoundError("railradar", "Train not found");
    }
    throw new TrainStatusUpstreamError(
      "railradar",
      `RailRadar reported failure: ${asString(error?.message) || asString(raw.message)}`,
    );
  }

  const data = isRecord(raw.data) ? raw.data : null;
  if (!data) {
    throw new TrainStatusUpstreamError("railradar", "Unexpected response shape");
  }

  const route = Array.isArray(data.route) ? data.route : null;
  if (!route) {
    throw new TrainStatusUpstreamError("railradar", "Unexpected response shape");
  }

  const rows: ProviderStationRow[] = route
    .map((entry): ProviderStationRow | null => {
      if (!isRecord(entry)) return null;
      return {
        station_code: asString(entry.stationCode),
        station_name: asString(entry.stationName),
        scheduled_arrival: isoTimeOfDay(entry.scheduledArrival),
        actual_arrival: isoTimeOfDay(entry.actualArrival),
        scheduled_departure: isoTimeOfDay(entry.scheduledDeparture),
        actual_departure: isoTimeOfDay(entry.actualDeparture),
        delay_minutes:
          toFiniteNumber(entry.delayArrival) ??
          toFiniteNumber(entry.delayDeparture),
        has_departed: entry.status === "departed" ? true : undefined,
        distance: toFiniteNumber(entry.distance),
        platform:
          entry.platform !== undefined && entry.platform !== null
            ? String(entry.platform)
            : null,
        halt_minutes: null,
        day: toPositiveInt(entry.day, 1),
      };
    })
    .filter((row): row is ProviderStationRow => row !== null);

  if (rows.length === 0) {
    throw new TrainStatusNotFoundError("railradar", "Train not found or no data");
  }

  const currentLocation = isRecord(data.currentLocation)
    ? data.currentLocation
    : null;

  return assembleMappedStatus(rows, {
    ...options,
    currentStationCode: asNullableString(currentLocation?.stationCode),
    statusMessage: asNullableString(data.status),
    lastUpdated: asNullableString(data.lastUpdatedAt),
  });
}

export interface RailRadarProviderOptions {
  /** RailRadar API key (required for this provider to be enabled). */
  apiKey?: string;
}

export class RailRadarProvider implements TrainStatusProvider {
  readonly name = "railradar";
  readonly enabled: boolean;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly endpoint = RAILRADAR_ENDPOINT,
  ) {
    this.enabled = !!apiKey;
  }

  fetchTrainStatus(
    trainNumber: string,
    departureDate: string,
    options: ProviderFetchOptions,
    knownTrain: KnownTrain | null = null,
  ): Promise<MappedStatus> {
    const railRadarDate = toRailRadarDate(departureDate);
    if (!railRadarDate) {
      return Promise.reject(
        new TrainStatusUpstreamError(
          this.name,
          `Unsupported date format: ${departureDate}`,
        ),
      );
    }

    const url = new URL(this.endpoint);
    url.searchParams.set("trainNumber", trainNumber);
    url.searchParams.set("dateOfJourney", railRadarDate);

    return fetchProviderStatus(
      {
        provider: this.name,
        url: url.toString(),
        responseType: "json",
        headers: {
          ...HEADERS,
          ...(this.apiKey ? { "x-api-key": this.apiKey } : {}),
        },
        map: (raw) =>
          mapRailRadarPayload(raw, {
            trainNumber,
            departureDate,
            knownTrain,
          }),
      },
      options,
    );
  }
}

export function createRailRadarProvider(
  options: RailRadarProviderOptions = {},
): TrainStatusProvider {
  return new RailRadarProvider(options.apiKey);
}

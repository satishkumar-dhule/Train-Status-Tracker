import type { MappedStatus } from "../train-status-mapper";
import { TrainStatusNotFoundError, TrainStatusUpstreamError } from "./errors";
import { fetchProviderStatus } from "./http";
import {
  assembleMappedStatus,
  type AssembleOptions,
  type ProviderStationRow,
} from "./normalize";
import {
  asBoolean,
  asNullableString,
  asString,
  isRecord,
  toFiniteNumber,
  toNullableInt,
} from "./parse";
import type { KnownTrain, ProviderFetchOptions, TrainStatusProvider } from "./types";

const WIMT_ENDPOINT = "https://whereismytrain.in/cache/live_status";

const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
};

/** YYYYMMDD -> DD-MM-YYYY, or null when not a valid 8-digit date. */
export function toWimtDate(departureDate: string): string | null {
  if (!/^\d{8}$/.test(departureDate)) return null;
  return `${departureDate.slice(6, 8)}-${departureDate.slice(4, 6)}-${departureDate.slice(0, 4)}`;
}

/** Map an untrusted WhereIsMyTrain body to a `MappedStatus`. */
export function mapWimtPayload(
  raw: unknown,
  options: AssembleOptions,
): MappedStatus {
  if (!isRecord(raw)) {
    throw new TrainStatusUpstreamError("whereismytrain", "Unexpected response shape");
  }

  const daysSchedule = Array.isArray(raw.days_schedule)
    ? raw.days_schedule
    : null;
  if (!daysSchedule) {
    throw new TrainStatusUpstreamError("whereismytrain", "Unexpected response shape");
  }
  if (daysSchedule.length === 0) {
    throw new TrainStatusNotFoundError("whereismytrain", "Train not found or no data");
  }

  const rows: ProviderStationRow[] = daysSchedule
    .map((entry): ProviderStationRow | null => {
      if (!isRecord(entry)) return null;
      return {
        station_code: asString(entry.station_code),
        // WIMT does not expose station names; leave empty for the name lookup
        // layer to fill in.
        station_name: "",
        scheduled_arrival: asNullableString(entry.sch_arrival_time),
        actual_arrival: asNullableString(entry.actual_arrival_time),
        scheduled_departure: asNullableString(entry.sch_departure_time),
        actual_departure: asNullableString(entry.actual_departure_time),
        delay_minutes:
          toFiniteNumber(entry.delay_in_arrival) ??
          toFiniteNumber(entry.delay_in_departure),
        has_departed: asBoolean(entry.departed),
        distance: toFiniteNumber(entry.distance),
        platform:
          entry.platform !== undefined && entry.platform !== null
            ? String(entry.platform)
            : null,
        halt_minutes: toNullableInt(entry.stops) ?? null,
        day: 1,
      };
    })
    .filter((row): row is ProviderStationRow => row !== null);

  if (rows.length === 0) {
    throw new TrainStatusNotFoundError("whereismytrain", "Train not found or no data");
  }

  return assembleMappedStatus(rows, {
    ...options,
    currentStationCode: asNullableString(raw.curStn),
    statusMessage: null,
    lastUpdated: asNullableString(raw.lastUpdateIsoDate),
  });
}

export class WhereIsMyTrainProvider implements TrainStatusProvider {
  readonly name = "whereismytrain";
  readonly enabled = true;

  fetchTrainStatus(
    trainNumber: string,
    departureDate: string,
    options: ProviderFetchOptions,
    knownTrain: KnownTrain | null = null,
  ): Promise<MappedStatus> {
    const wimtDate = toWimtDate(departureDate);
    if (!wimtDate) {
      return Promise.reject(
        new TrainStatusUpstreamError(
          this.name,
          `Unsupported date format: ${departureDate}`,
        ),
      );
    }

    const url = new URL(WIMT_ENDPOINT);
    url.searchParams.set("train_no", trainNumber);
    url.searchParams.set("date", wimtDate);
    url.searchParams.set("lang", "en");

    return fetchProviderStatus(
      {
        provider: this.name,
        url: url.toString(),
        responseType: "json",
        headers: HEADERS,
        map: (raw) =>
          mapWimtPayload(raw, {
            trainNumber,
            departureDate,
            knownTrain,
          }),
      },
      options,
    );
  }
}

export function createWhereIsMyTrainProvider(): TrainStatusProvider {
  return new WhereIsMyTrainProvider();
}

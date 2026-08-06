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
  toPositiveInt,
} from "./parse";
import type { KnownTrain, ProviderFetchOptions, TrainStatusProvider } from "./types";

const GOIBIBO_ENDPOINT =
  "https://rails-ris.makemytrip.com/api/ris/train/livestatus/v2";

const HEADERS: Record<string, string> = {
  Accept: "application/json",
  "Content-Type": "application/json",
  Origin: "https://www.goibibo.com",
  Referer: "https://www.goibibo.com/",
  "User-Agent":
    "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
};

/** YYYYMMDD -> DD-MM-YYYY, or null when the input is not a valid 8-digit date. */
export function toGoibiboDate(departureDate: string): string | null {
  if (!/^\d{8}$/.test(departureDate)) return null;
  return `${departureDate.slice(6, 8)}-${departureDate.slice(4, 6)}-${departureDate.slice(0, 4)}`;
}

/** Map an untrusted Goibibo/MMT livestatus body to a `MappedStatus`. */
export function mapGoibiboPayload(
  raw: unknown,
  options: AssembleOptions,
): MappedStatus {
  if (!isRecord(raw) || raw.success !== true) {
    throw new TrainStatusNotFoundError("goibibo", "Train not found or no data");
  }
  const response = isRecord(raw.response) ? raw.response : null;
  if (!response) {
    throw new TrainStatusUpstreamError("goibibo", "Unexpected response shape");
  }

  const rawStations = Array.isArray(response.stations)
    ? response.stations
    : null;
  if (!rawStations) {
    throw new TrainStatusUpstreamError("goibibo", "Unexpected response shape");
  }

  const rows: ProviderStationRow[] = rawStations
    .map((entry): ProviderStationRow | null => {
      if (!isRecord(entry)) return null;
      const station = isRecord(entry.Station) ? entry.Station : {};
      const arrival = isRecord(entry.ArrivalDetails) ? entry.ArrivalDetails : {};
      const departure = isRecord(entry.DepartureDetails)
        ? entry.DepartureDetails
        : {};
      const day = isRecord(entry.DayDetails) ? entry.DayDetails : {};

      return {
        station_code: asString(station.code),
        station_name: asString(station.name),
        scheduled_arrival: asNullableString(arrival.scheduledArrivalTime),
        actual_arrival: asNullableString(arrival.actualArrivalTime),
        scheduled_departure: asNullableString(departure.scheduledDepartureTime),
        actual_departure: asNullableString(departure.actualDepartureTime),
        has_departed: asBoolean(departure.departed),
        distance: toFiniteNumber(entry.Distance),
        platform:
          station.expectedPlatformNumber !== undefined &&
          station.expectedPlatformNumber !== null
            ? String(station.expectedPlatformNumber)
            : null,
        halt_minutes: toFiniteNumber(entry.HaltMinutes),
        day: toPositiveInt(day.dayCount, 1),
      };
    })
    .filter(
      (row): row is ProviderStationRow =>
        row !== null && row.station_code !== "",
    );

  const meta = isRecord(response.metaDetails) ? response.metaDetails : null;
  const trainDetails = isRecord(response.trainDetails)
    ? response.trainDetails
    : null;

  const currentStationCode =
    asNullableString(meta?.curStnData && isRecord(meta.curStnData) && isRecord(meta.curStnData.station) ? meta.curStnData.station.code : null) ??
    asNullableString(
      trainDetails?.currentStation && isRecord(trainDetails.currentStation)
        ? trainDetails.currentStation.code
        : null,
    );

  const otherDetails = isRecord(meta?.othrDetails) ? meta.othrDetails : null;

  return assembleMappedStatus(rows, {
    ...options,
    currentStationCode,
    statusMessage:
      asNullableString(otherDetails?.timeDetail) ??
      asNullableString(otherDetails?.delay),
    lastUpdated: asNullableString(response.lastUpdated),
  });
}

export class GoibiboProvider implements TrainStatusProvider {
  readonly name = "goibibo";
  readonly enabled = true;

  fetchTrainStatus(
    trainNumber: string,
    departureDate: string,
    options: ProviderFetchOptions,
    knownTrain: KnownTrain | null = null,
  ): Promise<MappedStatus> {
    const goibiboDate = toGoibiboDate(departureDate);
    if (!goibiboDate) {
      return Promise.reject(
        new TrainStatusUpstreamError(
          this.name,
          `Unsupported date format: ${departureDate}`,
        ),
      );
    }

    return fetchProviderStatus(
      {
        provider: this.name,
        url: GOIBIBO_ENDPOINT,
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({
          trainNumber,
          dateOfJourney: goibiboDate,
          findNextRunningDate: true,
        }),
        responseType: "json",
        map: (raw) =>
          mapGoibiboPayload(raw, {
            trainNumber,
            departureDate,
            knownTrain,
          }),
      },
      options,
    );
  }
}

export function createGoibiboProvider(): TrainStatusProvider {
  return new GoibiboProvider();
}

import {
  parsePaytmResponseBody,
  PaytmTrainNotFoundError,
  PaytmUpstreamError,
  type PaytmStation,
} from "../paytm-client";
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
import type { KnownTrain, ProviderFetchOptions, TrainStatusProvider } from "./types";

const PAYTM_BASE = "https://travel.paytm.com/api/trains/v1/train/status";

function toRow(station: PaytmStation): ProviderStationRow {
  // Legacy semantics: scheduled times only count when the station has a
  // day count, otherwise the entry is a "through" station with no times.
  const scheduledArrival =
    station.arrivalTime && station.dayCount ? String(station.arrivalTime) : null;
  const scheduledDeparture =
    station.departureTime && station.dayCount
      ? String(station.departureTime)
      : null;
  const distance = Number(station.distance);
  const day = parseInt(String(station.dayCount ?? "1"), 10);

  return {
    station_code: String(station.stationCode ?? ""),
    station_name: String(station.stationName ?? ""),
    scheduled_arrival: scheduledArrival,
    actual_arrival:
      typeof station.actual_arrival_time === "string"
        ? station.actual_arrival_time
        : null,
    scheduled_departure: scheduledDeparture,
    actual_departure:
      typeof station.actual_departure_time === "string"
        ? station.actual_departure_time
        : null,
    distance: Number.isFinite(distance) ? distance : null,
    platform:
      station.expected_platform !== undefined
        ? String(station.expected_platform)
        : null,
    halt_minutes: typeof station.haltTime === "number" ? station.haltTime : null,
    day: Number.isNaN(day) ? 1 : day,
  };
}

/** Map an untrusted Paytm body to a `MappedStatus`, adapting its error taxonomy. */
export function mapPaytmPayload(
  raw: unknown,
  options: AssembleOptions,
): MappedStatus {
  try {
    const payload = parsePaytmResponseBody(raw);
    const rows = payload.stations.map(toRow);
    return assembleMappedStatus(rows, {
      ...options,
      currentStationCode: payload.current_station,
      statusMessage: payload.train_status_message,
      lastUpdated: payload.server_timestamp,
    });
  } catch (err) {
    if (err instanceof PaytmTrainNotFoundError) {
      throw new TrainStatusNotFoundError("paytm", err.message);
    }
    if (err instanceof PaytmUpstreamError) {
      throw new TrainStatusUpstreamError("paytm", err.message);
    }
    throw err;
  }
}

export class PaytmProvider implements TrainStatusProvider {
  readonly name = "paytm";
  readonly enabled = true;

  constructor(
    private readonly baseUrl = PAYTM_BASE,
    private readonly headers: Record<string, string> = {
      "User-Agent":
        "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
      Accept: "application/json",
    },
  ) {}

  fetchTrainStatus(
    trainNumber: string,
    departureDate: string,
    options: ProviderFetchOptions,
    knownTrain: KnownTrain | null = null,
  ): Promise<MappedStatus> {
    const url = new URL(this.baseUrl);
    url.searchParams.set("train_number", trainNumber);
    url.searchParams.set("departure_date", departureDate);
    url.searchParams.set("isH5", "true");
    url.searchParams.set("client", "web");
    url.searchParams.set("deviceIdentifier", "Mozilla Firefox-150.0.0.0");

    return fetchProviderStatus(
      {
        provider: this.name,
        url: url.toString(),
        responseType: "json",
        headers: this.headers,
        map: (raw) =>
          mapPaytmPayload(raw, {
            trainNumber,
            departureDate,
            knownTrain,
          }),
      },
      options,
    );
  }
}

export function createPaytmProvider(): TrainStatusProvider {
  return new PaytmProvider();
}

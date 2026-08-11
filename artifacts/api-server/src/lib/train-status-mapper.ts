import type { PaytmStation, PaytmTrainStatusPayload } from "./paytm-client";
import { calcDelay, stripHtml } from "@workspace/trains-data";

export function computeCurrentSerial(
  stations: PaytmStation[],
  currentStationCode: string | null,
): number {
  for (const station of stations) {
    if (station.stationCode === currentStationCode) {
      return parseInt(String(station.stnSerialNumber), 10) || 0;
    }
  }
  return 0;
}

export interface MappedStation {
  station_code: string;
  station_name: string;
  scheduled_arrival: string | null;
  actual_arrival: string | null;
  scheduled_departure: string | null;
  actual_departure: string | null;
  delay_minutes: number | null;
  distance_from_source: number | null;
  platform: string | null;
  halt_minutes: number | null;
  has_departed: boolean;
  is_current: boolean;
  day: number;
}

export function mapStation(
  station: PaytmStation,
  currentStationCode: string | null,
  currentSerial: number,
): MappedStation {
  const serial = parseInt(String(station.stnSerialNumber ?? "0"), 10);
  const serialNumber = Number.isNaN(serial) ? 0 : serial;
  const isCurrent = station.stationCode === currentStationCode;
  const hasDeparted =
    serialNumber < currentSerial ||
    (isCurrent && !!station.actual_departure_time);

  const scheduledArrival =
    station.arrivalTime && station.dayCount
      ? String(station.arrivalTime)
      : null;
  const scheduledDeparture =
    station.departureTime && station.dayCount
      ? String(station.departureTime)
      : null;
  const actualArrival =
    typeof station.actual_arrival_time === "string"
      ? station.actual_arrival_time
      : null;
  const actualDeparture =
    typeof station.actual_departure_time === "string"
      ? station.actual_departure_time
      : null;

  const distance = Number(station.distance);
  const day = parseInt(String(station.dayCount ?? "1"), 10);

  return {
    station_code: String(station.stationCode ?? ""),
    station_name: String(station.stationName ?? ""),
    scheduled_arrival: scheduledArrival,
    actual_arrival: actualArrival,
    scheduled_departure: scheduledDeparture,
    actual_departure: actualDeparture,
    delay_minutes: calcDelay(scheduledArrival, actualArrival),
    distance_from_source: Number.isFinite(distance) ? distance : null,
    platform:
      station.expected_platform !== undefined
        ? String(station.expected_platform)
        : null,
    halt_minutes: typeof station.haltTime === "number" ? station.haltTime : null,
    has_departed: hasDeparted,
    is_current: isCurrent,
    day: Number.isNaN(day) ? 1 : day,
  };
}

export interface MappedStatus {
  train_number: string;
  train_name: string;
  departure_date: string;
  source_station_code: string;
  source_station_name: string;
  destination_station_code: string;
  destination_station_name: string;
  current_station_code: string | null;
  current_station_name: string | null;
  current_delay_minutes: number | null;
  status_message: string | null;
  last_updated: string | null;
  /** The upstream ("gateway") that produced this status; set by the orchestrator. */
  provider: string;
  stations: MappedStation[];
}

export function mapStatusResponse(
  payload: PaytmTrainStatusPayload,
  trainNumber: string,
  departureDate: string,
  knownTrain: { number: string; name: string } | null,
): MappedStatus {
  const stationList = payload.stations ?? [];
  const currentStationCode = payload.current_station ?? null;
  const currentSerial = computeCurrentSerial(stationList, currentStationCode);
  const stations = stationList.map((station) =>
    mapStation(station, currentStationCode, currentSerial),
  );

  const currentStation = stations.find((station) => station.is_current);
  const firstStation = stations[0];
  const lastStation = stations[stations.length - 1];

  return {
    train_number: trainNumber,
    train_name: knownTrain ? knownTrain.name : `Train ${trainNumber}`,
    departure_date: departureDate,
    source_station_code: firstStation?.station_code ?? "",
    source_station_name: firstStation?.station_name ?? "",
    destination_station_code: lastStation?.station_code ?? "",
    destination_station_name: lastStation?.station_name ?? "",
    current_station_code: currentStationCode,
    current_station_name: currentStation?.station_name ?? null,
    current_delay_minutes: currentStation?.delay_minutes ?? null,
    status_message: stripHtml(payload.train_status_message),
    last_updated: payload.server_timestamp ?? null,
    provider: "",
    stations,
  };
}

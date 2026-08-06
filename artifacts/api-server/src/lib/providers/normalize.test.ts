import { describe, expect, it } from "vitest";
import {
  assembleMappedStatus,
  computeRowCurrentSerial,
  toMappedStation,
  type ProviderStationRow,
} from "./normalize";

function row(overrides: Partial<ProviderStationRow> = {}): ProviderStationRow {
  return {
    station_code: "NDLS",
    station_name: "New Delhi",
    scheduled_arrival: "08:00",
    actual_arrival: "08:20",
    scheduled_departure: "08:05",
    actual_departure: null,
    distance: 391,
    platform: "5",
    halt_minutes: 5,
    day: 1,
    ...overrides,
  };
}

describe("computeRowCurrentSerial", () => {
  it("returns the 1-based position of the current station", () => {
    const rows = [row({ station_code: "ADI" }), row({ station_code: "NDLS" })];
    expect(computeRowCurrentSerial(rows, "NDLS")).toBe(2);
  });

  it("returns 0 when no station matches", () => {
    expect(computeRowCurrentSerial([row()], "BPL")).toBe(0);
  });

  it("returns 0 for a null current station code", () => {
    expect(computeRowCurrentSerial([row()], null)).toBe(0);
  });
});

describe("toMappedStation", () => {
  it("maps a fully populated row", () => {
    expect(toMappedStation(row(), 0, "NDLS", 1)).toEqual({
      station_code: "NDLS",
      station_name: "New Delhi",
      scheduled_arrival: "08:00",
      actual_arrival: "08:20",
      scheduled_departure: "08:05",
      actual_departure: null,
      delay_minutes: 20,
      distance_from_source: 391,
      platform: "5",
      halt_minutes: 5,
      has_departed: false,
      is_current: true,
      day: 1,
    });
  });

  it("applies defaults for missing fields", () => {
    expect(toMappedStation({ ...row(), distance: null }, 5, null, 0)).toEqual(
      expect.objectContaining({
        station_code: "NDLS",
        delay_minutes: 20,
        distance_from_source: null,
        has_departed: false,
        is_current: false,
        day: 1,
      }),
    );
  });

  it("marks rows before the current serial as departed", () => {
    expect(
      toMappedStation(row({ actual_departure: null }), 0, "NDLS", 4).has_departed,
    ).toBe(true);
  });

  it("keeps future rows undeparted", () => {
    expect(
      toMappedStation(row({ actual_departure: null }), 5, "NDLS", 4).has_departed,
    ).toBe(false);
  });

  it("marks the current station departed only once it has left", () => {
    const atStation = toMappedStation(row({ actual_departure: null }), 3, "NDLS", 4);
    const departed = toMappedStation(row({ actual_departure: "08:05" }), 3, "NDLS", 4);
    expect(atStation.has_departed).toBe(false);
    expect(departed.has_departed).toBe(true);
  });

  it("honors an explicit has_departed flag", () => {
    const rowWithFlag = row({ has_departed: true });
    expect(
      toMappedStation(rowWithFlag, 5, "NDLS", 4).has_departed,
    ).toBe(true);
  });

  it("uses an explicit delay_minutes over computed delay", () => {
    expect(
      toMappedStation(row({ delay_minutes: 99 }), 0, null, 0).delay_minutes,
    ).toBe(99);
  });

  it("falls back to null for a non-finite distance", () => {
    expect(
      toMappedStation(row({ distance: null }), 0, null, 0).distance_from_source,
    ).toBeNull();
  });

  it("coerces platform to a string and keeps a zero distance", () => {
    const mapped = toMappedStation(row({ distance: 0 }), 0, null, 0);
    expect(mapped.platform).toBe("5");
    expect(mapped.distance_from_source).toBe(0);
  });
});

describe("assembleMappedStatus", () => {
  const rows: ProviderStationRow[] = [
    row({ station_code: "ADI", station_name: "Ahmedabad Jn", distance: 0 }),
    row({
      station_code: "NDLS",
      station_name: "New Delhi",
      scheduled_arrival: "08:00",
      actual_arrival: "08:20",
      distance: 938,
      day: 2,
    }),
  ];

  it("assembles the full status", () => {
    const status = assembleMappedStatus(rows, {
      trainNumber: "12301",
      departureDate: "20260805",
      knownTrain: { number: "12301", name: "Howrah Rajdhani Express" },
      currentStationCode: "NDLS",
      statusMessage: "Running <b>on time</b>",
      lastUpdated: "2026-08-05T12:00:00Z",
    });

    expect(status).toEqual({
      train_number: "12301",
      train_name: "Howrah Rajdhani Express",
      departure_date: "20260805",
      source_station_code: "ADI",
      source_station_name: "Ahmedabad Jn",
      destination_station_code: "NDLS",
      destination_station_name: "New Delhi",
      current_station_code: "NDLS",
      current_station_name: "New Delhi",
      current_delay_minutes: 20,
      status_message: "Running on time",
      last_updated: "2026-08-05T12:00:00Z",
      stations: expect.any(Array),
    });
    expect(status.stations[1]).toMatchObject({
      is_current: true,
      has_departed: false,
      day: 2,
    });
    expect(status.stations[0].has_departed).toBe(true);
  });

  it("uses the fallback train name when unknown", () => {
    const status = assembleMappedStatus(rows, {
      trainNumber: "12301",
      departureDate: "20260805",
      knownTrain: null,
    });
    expect(status.train_name).toBe("Train 12301");
  });

  it("handles an empty station list", () => {
    const status = assembleMappedStatus([], {
      trainNumber: "12301",
      departureDate: "20260805",
      knownTrain: null,
    });
    expect(status.stations).toEqual([]);
    expect(status.source_station_code).toBe("");
    expect(status.current_station_code).toBeNull();
  });

  it("leaves current station details null when none matches", () => {
    const status = assembleMappedStatus(rows, {
      trainNumber: "12301",
      departureDate: "20260805",
      knownTrain: null,
      currentStationCode: "ABC",
    });
    expect(status.current_station_name).toBeNull();
    expect(status.current_delay_minutes).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import type { PaytmStation, PaytmTrainStatusPayload } from "./paytm-client";
import {
  computeCurrentSerial,
  mapStation,
  mapStatusResponse,
} from "./train-status-mapper";

function station(overrides: Partial<PaytmStation> = {}): PaytmStation {
  return {
    stationCode: "NDLS",
    stationName: "New Delhi",
    arrivalTime: "08:00",
    departureTime: "08:05",
    dayCount: "1",
    stnSerialNumber: "3",
    actual_arrival_time: "08:20",
    actual_departure_time: "08:25",
    distance: 391,
    expected_platform: "5",
    haltTime: 5,
    ...overrides,
  };
}

function statusPayload(
  overrides: Partial<PaytmTrainStatusPayload> = {},
): PaytmTrainStatusPayload {
  return {
    current_station: "NDLS",
    train_status_message: "Running <b>on time</b>",
    server_timestamp: "2026-08-05T12:00:00Z",
    stations: [
      station({
        stationCode: "NDLS",
        stnSerialNumber: "1",
        actual_departure_time: null,
      }),
      station({
        stationCode: "CNB",
        stationName: "Kanpur",
        stnSerialNumber: "2",
        actual_departure_time: null,
      }),
    ],
    ...overrides,
  };
}

describe("mapStation", () => {
  it("maps a fully populated station", () => {
    expect(mapStation(station(), "NDLS", 3)).toEqual({
      station_code: "NDLS",
      station_name: "New Delhi",
      scheduled_arrival: "08:00",
      actual_arrival: "08:20",
      scheduled_departure: "08:05",
      actual_departure: "08:25",
      delay_minutes: 20,
      distance_from_source: 391,
      platform: "5",
      halt_minutes: 5,
      has_departed: true,
      is_current: true,
      day: 1,
    });
  });

  it("applies defaults for missing fields", () => {
    expect(mapStation({}, "XYZ", 0)).toEqual({
      station_code: "",
      station_name: "",
      scheduled_arrival: null,
      actual_arrival: null,
      scheduled_departure: null,
      actual_departure: null,
      delay_minutes: null,
      distance_from_source: null,
      platform: null,
      halt_minutes: null,
      has_departed: false,
      is_current: false,
      day: 1,
    });
  });

  it("requires dayCount for scheduled times", () => {
    const result = mapStation(
      station({ arrivalTime: "08:00", departureTime: "08:05", dayCount: undefined }),
      null,
      0,
    );
    expect(result.scheduled_arrival).toBeNull();
    expect(result.scheduled_departure).toBeNull();
    expect(result.day).toBe(1);
  });

  it("returns null for a non-numeric distance", () => {
    expect(mapStation(station({ distance: "abc" }), null, 0).distance_from_source).toBeNull();
  });

  it("keeps numeric distance values including zero", () => {
    expect(mapStation(station({ distance: 0 }), null, 0).distance_from_source).toBe(0);
    expect(mapStation(station({ distance: "123" }), null, 0).distance_from_source).toBe(123);
  });

  it("coerces platform to a string and rejects non-number halt", () => {
    const result = mapStation(
      station({ expected_platform: 5, haltTime: "10" as unknown as number }),
      null,
      0,
    );
    expect(result.platform).toBe("5");
    expect(result.halt_minutes).toBeNull();
  });

  it("defaults a NaN day to 1", () => {
    expect(mapStation(station({ dayCount: "x" }), null, 0).day).toBe(1);
  });

  it("marks stations before the current serial as departed", () => {
    const result = mapStation(
      station({ stationCode: "DLI", stnSerialNumber: "2", actual_departure_time: null }),
      "NDLS",
      4,
    );
    expect(result.has_departed).toBe(true);
  });

  it("keeps future stations undeparted", () => {
    const result = mapStation(
      station({ stationCode: "CNB", stnSerialNumber: "6", actual_departure_time: null }),
      "NDLS",
      4,
    );
    expect(result.has_departed).toBe(false);
  });

  it("marks the current station departed only once it has left", () => {
    const atStation = station({
      stationCode: "NDLS",
      stnSerialNumber: "4",
      actual_departure_time: null,
    });
    const departed = station({
      stationCode: "NDLS",
      stnSerialNumber: "4",
      actual_departure_time: "08:05",
    });
    expect(mapStation(atStation, "NDLS", 4).has_departed).toBe(false);
    expect(mapStation(departed, "NDLS", 4).has_departed).toBe(true);
  });

  it("defaults a NaN serial to 0 for the departed check", () => {
    const result = mapStation(
      station({ stationCode: "DLI", stnSerialNumber: "abc", actual_departure_time: null }),
      "NDLS",
      1,
    );
    expect(result.has_departed).toBe(true);
  });

  it("flags the matching station as current", () => {
    expect(mapStation(station({ stationCode: "NDLS" }), "NDLS", 0).is_current).toBe(true);
    expect(mapStation(station({ stationCode: "NDLS" }), "CNB", 0).is_current).toBe(false);
  });
});

describe("computeCurrentSerial", () => {
  it("returns the serial of the matching station", () => {
    const stations = [
      station({ stationCode: "NDLS", stnSerialNumber: "1" }),
      station({ stationCode: "CNB", stnSerialNumber: "4" }),
    ];
    expect(computeCurrentSerial(stations, "CNB")).toBe(4);
  });

  it("returns 0 when no station matches", () => {
    expect(computeCurrentSerial([station()], "BPL")).toBe(0);
  });

  it("returns 0 for a null current station code", () => {
    expect(computeCurrentSerial([station()], null)).toBe(0);
  });

  it("falls back to 0 for a non-numeric serial", () => {
    expect(
      computeCurrentSerial(
        [station({ stationCode: "NDLS", stnSerialNumber: "abc" })],
        "NDLS",
      ),
    ).toBe(0);
  });
});

describe("mapStatusResponse", () => {
  it("maps the full status response", () => {
    const result = mapStatusResponse(
      statusPayload({
        stations: [
          station({
            stationCode: "NDLS",
            stnSerialNumber: "1",
            actual_departure_time: null,
          }),
          station({
            stationCode: "CNB",
            stationName: "Kanpur",
            stnSerialNumber: "2",
            actual_departure_time: null,
          }),
        ],
      }),
      "12301",
      "20260805",
      { number: "12301", name: "Howrah Rajdhani Express" },
    );

    expect(result).toEqual({
      train_number: "12301",
      train_name: "Howrah Rajdhani Express",
      departure_date: "20260805",
      source_station_code: "NDLS",
      source_station_name: "New Delhi",
      destination_station_code: "CNB",
      destination_station_name: "Kanpur",
      current_station_code: "NDLS",
      current_station_name: "New Delhi",
      current_delay_minutes: 20,
      status_message: "Running on time",
      last_updated: "2026-08-05T12:00:00Z",
      provider: "",
      stations: [
        expect.objectContaining({
          station_code: "NDLS",
          is_current: true,
          delay_minutes: 20,
        }),
        expect.objectContaining({
          station_code: "CNB",
          is_current: false,
          delay_minutes: 20,
        }),
      ],
    });
  });

  it("uses the fallback train name when unknown", () => {
    const result = mapStatusResponse(statusPayload(), "12301", "20260805", null);
    expect(result.train_name).toBe("Train 12301");
  });

  it("strips HTML from the status message", () => {
    const result = mapStatusResponse(
      statusPayload({ train_status_message: "Running <em>on time</em> now" }),
      "12301",
      "20260805",
      null,
    );
    expect(result.status_message).toBe("Running on time now");
  });

  it("returns null status when the message is missing", () => {
    const result = mapStatusResponse(
      statusPayload({ train_status_message: null }),
      "12301",
      "20260805",
      null,
    );
    expect(result.status_message).toBeNull();
  });

  it("returns null current station details when none matches", () => {
    const result = mapStatusResponse(
      statusPayload({ current_station: "ABC" }),
      "12301",
      "20260805",
      null,
    );
    expect(result.current_station_code).toBe("ABC");
    expect(result.current_station_name).toBeNull();
    expect(result.current_delay_minutes).toBeNull();
  });

  it("handles an empty stations array", () => {
    const result = mapStatusResponse(
      {
        current_station: null,
        train_status_message: null,
        server_timestamp: null,
        stations: [],
      },
      "12301",
      "20260805",
      null,
    );
    expect(result).toEqual({
      train_number: "12301",
      train_name: "Train 12301",
      departure_date: "20260805",
      source_station_code: "",
      source_station_name: "",
      destination_station_code: "",
      destination_station_name: "",
      current_station_code: null,
      current_station_name: null,
      current_delay_minutes: null,
      status_message: null,
      last_updated: null,
      provider: "",
      stations: [],
    });
  });
});

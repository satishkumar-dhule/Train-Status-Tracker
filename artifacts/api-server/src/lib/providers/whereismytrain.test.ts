import { describe, expect, it, vi } from "vitest";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import { mapWimtPayload, toWimtDate, WhereIsMyTrainProvider } from "./whereismytrain";

const wimtRaw = {
  start_date: "02-08-2026",
  source_station: "HWH",
  destination_station: "NDLS",
  curStn: "CNB",
  eta: "3 mins",
  train_name: "Howrah Rajdhani Express",
  lastUpdateIsoDate: "2026-08-06T13:18:01.578613+05:30",
  days_schedule: [
    {
      station_code: "HWH",
      station_name: "",
      sch_arrival_time: "17:00",
      actual_arrival_time: "17:00",
      sch_departure_time: "17:15",
      actual_departure_time: "17:15",
      delay_in_arrival: 0,
      delay_in_departure: 0,
      platform: "10",
      distance: 0,
      sno: 1,
      departed: true,
    },
    {
      station_code: "CNB",
      station_name: "",
      sch_arrival_time: "08:00",
      actual_arrival_time: "08:05",
      sch_departure_time: "08:05",
      actual_departure_time: null,
      delay_in_arrival: 5,
      delay_in_departure: 5,
      platform: "4",
      distance: 1200,
      sno: 2,
      departed: false,
    },
    {
      station_code: "NDLS",
      station_name: "",
      sch_arrival_time: "08:25",
      actual_arrival_time: null,
      sch_departure_time: "08:35",
      actual_departure_time: null,
      delay_in_arrival: null,
      delay_in_departure: null,
      platform: null,
      distance: 1447,
      sno: 3,
      departed: false,
    },
  ],
};

const KNOWN = { number: "12301", name: "Howrah Rajdhani Express" };

describe("toWimtDate", () => {
  it("converts YYYYMMDD to DD-MM-YYYY", () => {
    expect(toWimtDate("20260806")).toBe("06-08-2026");
  });

  it("returns null for a malformed date", () => {
    expect(toWimtDate("bogus")).toBeNull();
  });
});

describe("mapWimtPayload", () => {
  it("maps the days_schedule with explicit departed flags", () => {
    const status = mapWimtPayload(wimtRaw, {
      trainNumber: "12301",
      departureDate: "20260806",
      knownTrain: KNOWN,
    });

    expect(status.current_station_code).toBe("CNB");
    expect(status.last_updated).toBe("2026-08-06T13:18:01.578613+05:30");
    expect(status.stations).toHaveLength(3);
    expect(status.stations[0]).toMatchObject({
      station_code: "HWH",
      scheduled_arrival: "17:00",
      actual_departure: "17:15",
      delay_minutes: 0,
      platform: "10",
      distance_from_source: 0,
      has_departed: true,
    });
    expect(status.stations[1]).toMatchObject({
      station_code: "CNB",
      is_current: true,
      delay_minutes: 5,
      has_departed: false,
      distance_from_source: 1200,
    });
    expect(status.stations[2].has_departed).toBe(false);
  });

  it("leaves station names empty for the name-lookup layer", () => {
    const status = mapWimtPayload(wimtRaw, {
      trainNumber: "12301",
      departureDate: "20260806",
      knownTrain: KNOWN,
    });
    expect(status.stations[0].station_name).toBe("");
    expect(status.source_station_name).toBe("");
  });

  it("reports not-found for an empty schedule", () => {
    expect(() =>
      mapWimtPayload(
        { ...wimtRaw, days_schedule: [] },
        { trainNumber: "1", departureDate: "20260806", knownTrain: null },
      ),
    ).toThrow(TrainStatusNotFoundError);
  });

  it("reports an upstream error when days_schedule is missing", () => {
    expect(() =>
      mapWimtPayload(
        { start_date: "02-08-2026" },
        { trainNumber: "1", departureDate: "20260806", knownTrain: null },
      ),
    ).toThrow(TrainStatusUpstreamError);
  });
});

describe("WhereIsMyTrainProvider", () => {
  it("builds the expected URL and returns mapped status", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(wimtRaw), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new WhereIsMyTrainProvider();

    const status = await provider.fetchTrainStatus("12301", "20260806", {
      fetchImpl,
    });

    expect(status.current_station_code).toBe("CNB");
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin).toBe("https://whereismytrain.in");
    expect(url.pathname).toBe("/cache/live_status");
    expect(url.searchParams.get("train_no")).toBe("12301");
    expect(url.searchParams.get("date")).toBe("06-08-2026");
    expect(url.searchParams.get("lang")).toBe("en");
  });

  it("rejects an unsupported date", async () => {
    await expect(
      new WhereIsMyTrainProvider().fetchTrainStatus("12301", "bogus", {}),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import {
  createRailRadarProvider,
  mapRailRadarPayload,
  RailRadarProvider,
  toRailRadarDate,
} from "./railradar";

const railRadarRaw = {
  success: true,
  data: {
    trainNumber: "12301",
    trainName: "Howrah Rajdhani Express",
    startDate: "2026-08-06",
    lastUpdatedAt: "2026-08-06T13:00:00+05:30",
    status: "Running on time",
    delayMinutes: 0,
    train: {
      source: { code: "HWH", name: "Howrah Jn" },
      destination: { code: "NDLS", name: "New Delhi" },
    },
    currentLocation: { stationCode: "CNB", sequence: 2, status: "arrived" },
    route: [
      {
        sequence: 1,
        stationCode: "HWH",
        stationName: "Howrah Jn",
        isHalt: true,
        scheduledArrival: "2026-08-06T17:00:00+05:30",
        scheduledDeparture: "2026-08-06T17:15:00+05:30",
        actualArrival: "2026-08-06T17:00:00+05:30",
        actualDeparture: "2026-08-06T17:15:00+05:30",
        delayArrival: 0,
        delayDeparture: 0,
        status: "departed",
        distance: 0,
        platform: "10",
      },
      {
        sequence: 2,
        stationCode: "CNB",
        stationName: "Kanpur Central",
        isHalt: true,
        scheduledArrival: "2026-08-06T08:00:00+05:30",
        scheduledDeparture: "2026-08-06T08:05:00+05:30",
        actualArrival: "2026-08-06T08:05:00+05:30",
        actualDeparture: null,
        delayArrival: 5,
        delayDeparture: 5,
        status: "arrived",
        distance: 1200,
        platform: "4",
      },
      {
        sequence: 3,
        stationCode: "NDLS",
        stationName: "New Delhi",
        isHalt: true,
        scheduledArrival: "2026-08-06T08:25:00+05:30",
        scheduledDeparture: "2026-08-06T08:35:00+05:30",
        actualArrival: null,
        actualDeparture: null,
        delayArrival: null,
        delayDeparture: null,
        status: "scheduled",
        distance: 1447,
        platform: null,
      },
    ],
  },
};

const KNOWN = { number: "12301", name: "Howrah Rajdhani Express" };

describe("toRailRadarDate", () => {
  it("converts YYYYMMDD to DD-MM-YYYY", () => {
    expect(toRailRadarDate("20260806")).toBe("06-08-2026");
  });

  it("returns null for a malformed date", () => {
    expect(toRailRadarDate("bogus")).toBeNull();
  });
});

describe("mapRailRadarPayload", () => {
  it("maps the route into stations", () => {
    const status = mapRailRadarPayload(railRadarRaw, {
      trainNumber: "12301",
      departureDate: "20260806",
      knownTrain: KNOWN,
    });

    expect(status.current_station_code).toBe("CNB");
    expect(status.status_message).toBe("Running on time");
    expect(status.last_updated).toBe("2026-08-06T13:00:00+05:30");
    expect(status.stations).toHaveLength(3);

    expect(status.stations[0]).toMatchObject({
      station_code: "HWH",
      station_name: "Howrah Jn",
      scheduled_arrival: "17:00",
      actual_departure: "17:15",
      delay_minutes: 0,
      platform: "10",
      has_departed: true,
    });
    expect(status.stations[1]).toMatchObject({
      station_code: "CNB",
      is_current: true,
      delay_minutes: 5,
      has_departed: false,
    });
    expect(status.stations[2]).toMatchObject({
      station_code: "NDLS",
      scheduled_arrival: "08:25",
      has_departed: false,
      delay_minutes: null,
    });
  });

  it("reports not-found on a NOT_FOUND error code", () => {
    expect(() =>
      mapRailRadarPayload(
        { success: false, error: { code: "NOT_FOUND", message: "Train not found" } },
        { trainNumber: "1", departureDate: "20260806", knownTrain: null },
      ),
    ).toThrow(TrainStatusNotFoundError);
  });

  it("reports an upstream error on other failures", () => {
    expect(() =>
      mapRailRadarPayload(
        { success: false, error: { code: "INTERNAL", message: "boom" } },
        { trainNumber: "1", departureDate: "20260806", knownTrain: null },
      ),
    ).toThrow(TrainStatusUpstreamError);
  });

  it("reports an upstream error when the response shape is missing", () => {
    expect(() =>
      mapRailRadarPayload(
        { success: true, data: {} },
        { trainNumber: "1", departureDate: "20260806", knownTrain: null },
      ),
    ).toThrow(TrainStatusUpstreamError);
  });
});

describe("RailRadarProvider", () => {
  it("is disabled without an api key and enabled with one", () => {
    expect(createRailRadarProvider().enabled).toBe(false);
    expect(createRailRadarProvider({ apiKey: "secret" }).enabled).toBe(true);
  });

  it("sends the api key header and builds the expected URL", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(railRadarRaw), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new RailRadarProvider("secret-key");

    const status = await provider.fetchTrainStatus("12301", "20260806", {
      fetchImpl,
    });

    expect(status.current_station_code).toBe("CNB");
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ "x-api-key": "secret-key" });
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.searchParams.get("trainNumber")).toBe("12301");
    expect(url.searchParams.get("dateOfJourney")).toBe("06-08-2026");
  });

  it("rejects an unsupported date", async () => {
    await expect(
      new RailRadarProvider("key").fetchTrainStatus("12301", "bogus", {}),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });
});

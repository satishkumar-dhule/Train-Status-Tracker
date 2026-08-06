import { describe, expect, it, vi } from "vitest";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import {
  GoibiboProvider,
  mapGoibiboPayload,
  toGoibiboDate,
} from "./goibibo";

const goibiboRaw = {
  success: true,
  response: {
    metaDetails: {
      curStnData: {
        station: { name: "New Delhi", code: "NDLS" },
        arrivalDetails: {
          schArrTime: "08:05",
          actArrTime: "08:35",
          arrDelay: 30,
          arrived: true,
        },
        departureDetails: {
          schDepTime: "08:10",
          actDepTime: "08:12",
          depDelay: 2,
          departed: true,
        },
      },
      othrDetails: {
        timeDetail: "Running on time",
        distanceDetail: "880 km",
        delay: "30",
      },
    },
    trainDetails: {
      trainNumber: "12301",
      trainName: "Howrah Rajdhani Express",
      currentStation: { name: "New Delhi", code: "NDLS" },
    },
    lastUpdated: "06-08-2026 12:54:00",
    stations: [
      {
        Station: { name: "Howrah Jn", code: "HWH", expectedPlatformNumber: 10 },
        HaltMinutes: 15,
        ArrivalDetails: {
          scheduledArrivalTime: "17:00",
          actualArrivalTime: "17:00",
        },
        DepartureDetails: {
          scheduledDepartureTime: "17:15",
          actualDepartureTime: "17:15",
        },
        DayDetails: { dayCount: 1 },
        Distance: 0,
      },
      {
        Station: { name: "New Delhi", code: "NDLS", expectedPlatformNumber: "3" },
        HaltMinutes: 10,
        ArrivalDetails: {
          scheduledArrivalTime: "08:05",
          actualArrivalTime: "08:35",
        },
        DepartureDetails: {
          scheduledDepartureTime: "08:10",
          actualDepartureTime: null,
          departed: false,
        },
        DayDetails: { dayCount: 2 },
        Distance: 1447,
      },
    ],
  },
};

const KNOWN = { number: "12301", name: "Howrah Rajdhani Express" };

describe("toGoibiboDate", () => {
  it("converts YYYYMMDD to DD-MM-YYYY", () => {
    expect(toGoibiboDate("20260806")).toBe("06-08-2026");
  });

  it("returns null for a malformed date", () => {
    expect(toGoibiboDate("2026-08-06")).toBeNull();
    expect(toGoibiboDate("notadate")).toBeNull();
  });
});

describe("mapGoibiboPayload", () => {
  it("maps a full payload", () => {
    const status = mapGoibiboPayload(goibiboRaw, {
      trainNumber: "12301",
      departureDate: "20260806",
      knownTrain: KNOWN,
    });

    expect(status.train_name).toBe("Howrah Rajdhani Express");
    expect(status.source_station_code).toBe("HWH");
    expect(status.destination_station_code).toBe("NDLS");
    expect(status.current_station_code).toBe("NDLS");
    expect(status.current_station_name).toBe("New Delhi");
    expect(status.current_delay_minutes).toBe(30);
    expect(status.status_message).toBe("Running on time");
    expect(status.last_updated).toBe("06-08-2026 12:54:00");
    expect(status.stations).toHaveLength(2);

    const current = status.stations[1];
    expect(current).toMatchObject({
      station_code: "NDLS",
      is_current: true,
      scheduled_arrival: "08:05",
      actual_arrival: "08:35",
      delay_minutes: 30,
      day: 2,
      platform: "3",
      distance_from_source: 1447,
    });
    expect(current.has_departed).toBe(false);

    expect(status.stations[0].has_departed).toBe(true);
    expect(status.stations[0].halt_minutes).toBe(15);
  });

  it("reports not-found when success is not true", () => {
    expect(() =>
      mapGoibiboPayload({ success: false, error: {} }, { trainNumber: "1", departureDate: "20260806", knownTrain: null }),
    ).toThrow(TrainStatusNotFoundError);
  });

  it("reports an upstream error when the response shape is missing", () => {
    expect(() =>
      mapGoibiboPayload(
        { success: true },
        { trainNumber: "1", departureDate: "20260806", knownTrain: null },
      ),
    ).toThrow(TrainStatusUpstreamError);
  });

  it("tolerates a malformed station entry", () => {
    const raw = {
      success: true,
      response: { stations: [{ broken: true }, ...goibiboRaw.response.stations] },
    };
    const status = mapGoibiboPayload(raw, {
      trainNumber: "12301",
      departureDate: "20260806",
      knownTrain: KNOWN,
    });
    expect(status.stations).toHaveLength(2);
  });
});

describe("GoibiboProvider", () => {
  it("POSTs the expected body and returns mapped status", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(goibiboRaw), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new GoibiboProvider();

    const status = await provider.fetchTrainStatus("12301", "20260806", {
      fetchImpl,
    });

    expect(status.current_station_code).toBe("NDLS");
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      trainNumber: "12301",
      dateOfJourney: "06-08-2026",
      findNextRunningDate: true,
    });
  });

  it("rejects an unsupported date", async () => {
    await expect(
      new GoibiboProvider().fetchTrainStatus("12301", "bogus", {}),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });
});

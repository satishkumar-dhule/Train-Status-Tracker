import { describe, expect, it, vi } from "vitest";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import { createPaytmProvider, mapPaytmPayload, PaytmProvider } from "./paytm";

const happyRaw = {
  status: { result: "success" },
  body: {
    stations: [
      {
        stnSerialNumber: 1,
        stationCode: "ADI",
        stationName: "Ahmedabad Jn",
        arrivalTime: "22:40",
        departureTime: "23:00",
        dayCount: 1,
        distance: 0,
        expected_platform: 1,
        haltTime: 20,
      },
      {
        stnSerialNumber: 2,
        stationCode: "NDLS",
        stationName: "New Delhi",
        arrivalTime: "08:05",
        departureTime: "08:15",
        dayCount: 2,
        actual_arrival_time: "08:40",
        actual_departure_time: null,
        distance: 938,
        expected_platform: "3",
        haltTime: 10,
      },
    ],
    current_station: "NDLS",
    train_status_message: "<b>Running on time</b>",
    server_timestamp: "2026-08-02T08:20:00+05:30",
  },
};

const KNOWN = { number: "22943", name: "Bandra Gujarat Express" };

describe("mapPaytmPayload", () => {
  it("maps the payload through the shared normalizer", () => {
    const status = mapPaytmPayload(happyRaw, {
      trainNumber: "22943",
      departureDate: "20260802",
      knownTrain: KNOWN,
    });

    expect(status.train_name).toBe("Bandra Gujarat Express");
    expect(status.current_station_code).toBe("NDLS");
    expect(status.current_station_name).toBe("New Delhi");
    expect(status.current_delay_minutes).toBe(35);
    expect(status.status_message).toBe("Running on time");
    expect(status.last_updated).toBe("2026-08-02T08:20:00+05:30");

    const current = status.stations[1];
    expect(current).toMatchObject({
      station_code: "NDLS",
      is_current: true,
      scheduled_arrival: "08:05",
      actual_arrival: "08:40",
      delay_minutes: 35,
      day: 2,
      platform: "3",
      halt_minutes: 10,
      distance_from_source: 938,
    });
    expect(status.stations[0]).toMatchObject({
      station_code: "ADI",
      halt_minutes: 20,
      has_departed: true,
    });
  });

  it("requires a day count for scheduled times", () => {
    const raw = {
      status: { result: "success" },
      body: {
        stations: [
          {
            stnSerialNumber: 1,
            stationCode: "ADI",
            stationName: "Ahmedabad Jn",
            arrivalTime: "22:40",
            dayCount: undefined,
          },
        ],
        current_station: null,
      },
    };
    const status = mapPaytmPayload(raw, {
      trainNumber: "22943",
      departureDate: "20260802",
      knownTrain: null,
    });
    expect(status.stations[0].scheduled_arrival).toBeNull();
  });

  it("adapts a not-found payload to TrainStatusNotFoundError", () => {
    expect(() =>
      mapPaytmPayload(
        { error: true, status: { result: "failure" } },
        { trainNumber: "22943", departureDate: "20260802", knownTrain: null },
      ),
    ).toThrow(TrainStatusNotFoundError);
  });

  it("adapts an ambiguous error to TrainStatusUpstreamError", () => {
    expect(() =>
      mapPaytmPayload(
        { error: true, status: { result: "service_unavailable" } },
        { trainNumber: "22943", departureDate: "20260802", knownTrain: null },
      ),
    ).toThrow(TrainStatusUpstreamError);
  });

  it("adapts a missing body to TrainStatusUpstreamError", () => {
    expect(() =>
      mapPaytmPayload(
        { status: { result: "success" }, body: null },
        { trainNumber: "22943", departureDate: "20260802", knownTrain: null },
      ),
    ).toThrow(TrainStatusUpstreamError);
  });
});

describe("PaytmProvider", () => {
  it("builds the expected URL and returns mapped status", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(happyRaw), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const status = await new PaytmProvider().fetchTrainStatus(
      "22943",
      "20260802",
      { fetchImpl },
    );

    expect(status.current_station_code).toBe("NDLS");
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe(
      "https://travel.paytm.com/api/trains/v1/train/status",
    );
    expect(url.searchParams.get("train_number")).toBe("22943");
    expect(url.searchParams.get("departure_date")).toBe("20260802");
  });

  it("returns the provider via the factory", () => {
    const provider = createPaytmProvider();
    expect(provider.name).toBe("paytm");
    expect(provider.enabled).toBe(true);
  });
});

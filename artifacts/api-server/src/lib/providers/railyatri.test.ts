import { describe, expect, it, vi } from "vitest";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import {
  computeStartDay,
  mapRailYatriPayload,
  RailYatriProvider,
} from "./railyatri";

const railyatriRaw = {
  success: true,
  train_number: "12301",
  train_name: "Howrah Rajdhani Express",
  train_start_date: "2026-08-06",
  update_time: "2026-08-06 13:01:00 +0530",
  status_as_of: "As of 3 mins ago",
  current_station_code: "CNB",
  current_station_name: "Kanpur Central",
  status: "A",
  eta: "08:05",
  etd: "08:10",
  cur_stn_sta: "08:00",
  cur_stn_std: "08:05",
  delay: 5,
  platform_number: 4,
  distance_from_source: 1200,
  total_distance: 1447,
  previous_stations: [
    {
      si_no: 1,
      station_code: "HWH",
      station_name: "Howrah Jn",
      sta: "17:00",
      std: "17:15",
      eta: "17:00",
      etd: "17:15",
      arrival_delay: 0,
      departure_delay: 0,
      platform_number: 10,
      distance_from_source: 0,
      stoppage_number: 1,
      day: 1,
    },
  ],
  upcoming_stations: [
    {
      si_no: 3,
      station_code: "NDLS",
      station_name: "New Delhi",
      sta: "08:25",
      std: "08:35",
      eta: null,
      etd: null,
      arrival_delay: null,
      departure_delay: null,
      platform_number: 3,
      distance_from_source: 1447,
      stoppage_number: 3,
      day: 2,
    },
  ],
};

const KNOWN = { number: "12301", name: "Howrah Rajdhani Express" };

describe("computeStartDay", () => {
  const now = new Date(2026, 7, 6, 12, 0, 0); // 2026-08-06 local

  it("returns 0 for today", () => {
    expect(computeStartDay("20260806", now)).toBe(0);
  });

  it("returns 1 for yesterday", () => {
    expect(computeStartDay("20260805", now)).toBe(1);
  });

  it("rejects dates outside the today/yesterday window", () => {
    expect(() => computeStartDay("20260804", now)).toThrow(
      TrainStatusUpstreamError,
    );
  });

  it("rejects malformed dates", () => {
    expect(() => computeStartDay("bogus", now)).toThrow(
      TrainStatusUpstreamError,
    );
  });
});

describe("mapRailYatriPayload", () => {
  it("maps previous, current, and upcoming stations", () => {
    const status = mapRailYatriPayload(railyatriRaw, {
      trainNumber: "12301",
      departureDate: "20260806",
      knownTrain: KNOWN,
    });

    expect(status.current_station_code).toBe("CNB");
    expect(status.current_station_name).toBe("Kanpur Central");
    expect(status.current_delay_minutes).toBe(5);
    expect(status.status_message).toBe("As of 3 mins ago");
    expect(status.last_updated).toBe("2026-08-06 13:01:00 +0530");
    expect(status.stations).toHaveLength(3);

    expect(status.stations[0]).toMatchObject({
      station_code: "HWH",
      station_name: "Howrah Jn",
      scheduled_arrival: "17:00",
      actual_arrival: "17:00",
      delay_minutes: 0,
      day: 1,
      has_departed: true,
    });
    expect(status.stations[1]).toMatchObject({
      station_code: "CNB",
      is_current: true,
      platform: "4",
      distance_from_source: 1200,
    });
    expect(status.stations[1].has_departed).toBe(false);
    expect(status.stations[2]).toMatchObject({
      station_code: "NDLS",
      is_current: false,
      has_departed: false,
      platform: "3",
    });
    expect(status.destination_station_code).toBe("NDLS");
  });

  it("reports not-found when success is false", () => {
    expect(() =>
      mapRailYatriPayload(
        { success: false },
        { trainNumber: "1", departureDate: "20260806", knownTrain: null },
      ),
    ).toThrow(TrainStatusNotFoundError);
  });

  it("tolerates a missing current station", () => {
    const raw = {
      ...railyatriRaw,
      current_station_code: null,
      current_station_name: null,
    };
    const status = mapRailYatriPayload(raw, {
      trainNumber: "12301",
      departureDate: "20260806",
      knownTrain: KNOWN,
    });
    expect(status.current_station_code).toBeNull();
    expect(status.stations.some((s) => s.is_current)).toBe(false);
  });
});

describe("RailYatriProvider", () => {
  it("builds the expected URL with start_day and returns mapped status", async () => {
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        new Response(JSON.stringify(railyatriRaw), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const provider = new RailYatriProvider(() => new Date(2026, 7, 6));

    const status = await provider.fetchTrainStatus("12301", "20260806", {
      fetchImpl,
    });

    expect(status.current_station_code).toBe("CNB");
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toMatch(/\/train_eta_data\/12301\/0\.json\?start_day=0$/);
  });

  it("rejects a date outside today/yesterday", async () => {
    const provider = new RailYatriProvider(() => new Date(2026, 7, 6));
    await expect(
      provider.fetchTrainStatus("12301", "20260804", { fetchImpl: vi.fn() }),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });
});

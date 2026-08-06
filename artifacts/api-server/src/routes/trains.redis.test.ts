import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gzipSync } from "node:zlib";
import request from "supertest";
import app from "../app";
import { defaultQosRegistry } from "../lib/providers/qos";

const TRAIN_NUMBER = "22943";
const REDIS_PREFIX = "tt:status:v1";

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const { fakeStore } = vi.hoisted(() => {
  const store = {
    available: true,
    data: new Map<string, { value: string | Buffer; ttlSeconds: number }>(),
    isAvailable: vi.fn(() => store.available),
    get: vi.fn(async (key: string) => store.data.get(key)?.value ?? null),
    set: vi.fn(
      async (key: string, value: string | Buffer, ttlSeconds: number) => {
        store.data.set(key, { value, ttlSeconds });
        return "OK";
      },
    ),
  };
  return { fakeStore: store };
});

vi.mock("../lib/redis-client", () => ({
  createRedisStore: () => fakeStore,
  shutdownRedis: vi.fn(async () => {}),
}));

function redisKey(date: string): string {
  return `${REDIS_PREFIX}:${TRAIN_NUMBER}:${date}`;
}

function seedValue(date: string, payload: unknown): void {
  fakeStore.data.set(redisKey(date), {
    value: gzipSync(Buffer.from(JSON.stringify(payload))),
    ttlSeconds: 300,
  });
}

function seedNegative(date: string): void {
  fakeStore.data.set(redisKey(date), { value: "tt:not-found", ttlSeconds: 60 });
}

const cachedPayload = {
  train_number: TRAIN_NUMBER,
  train_name: "Indore Intercity SF Express",
  departure_date: "20260802",
  source_station_code: "INDB",
  source_station_name: "Indore Jn BG",
  destination_station_code: "NDLS",
  destination_station_name: "New Delhi",
  current_station_code: "NDLS",
  current_station_name: "New Delhi",
  current_delay_minutes: 0,
  status_message: "Running on time",
  last_updated: "2026-08-02T08:20:00+05:30",
  stations: [
    {
      station_code: "ADI",
      station_name: "Ahmedabad Jn",
      has_departed: true,
      is_current: false,
      day: 1,
      scheduled_arrival: null,
      scheduled_departure: "23:00",
      actual_arrival: null,
      actual_departure: "23:00",
      delay_minutes: 0,
      distance_from_source: 0,
    },
    {
      station_code: "NDLS",
      station_name: "New Delhi",
      has_departed: true,
      is_current: true,
      day: 2,
      scheduled_arrival: "08:05",
      scheduled_departure: null,
      actual_arrival: "08:40",
      actual_departure: null,
      delay_minutes: 35,
      distance_from_source: 938,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  fakeStore.available = true;
  fakeStore.data.clear();
  defaultQosRegistry.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/trains/status with Redis cache", () => {
  it("serves a Redis hit without calling the upstream", async () => {
    seedValue("20260802", cachedPayload);
    const fetchSpy = vi.fn(async () => jsonResponse(happyRaw));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260802" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedPayload);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("serves a cached not-found marker as 404 without hitting the upstream", async () => {
    seedNegative("20260803");
    const fetchSpy = vi.fn(async () => jsonResponse(happyRaw));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260803" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Train not found or no data available" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fetches upstream on a Redis miss and writes the result to Redis", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(happyRaw));
    vi.stubGlobal("fetch", fetchSpy);

    const query = { train_number: TRAIN_NUMBER, departure_date: "20260804" };
    const res = await request(app).get("/api/trains/status").query(query);

    expect(res.status).toBe(200);
    expect(res.body.train_number).toBe(TRAIN_NUMBER);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const stored = fakeStore.data.get(redisKey("20260804"));
    expect(stored).toBeDefined();
    expect(Buffer.isBuffer(stored!.value)).toBe(true);

    const second = await request(app).get("/api/trains/status").query(query);
    expect(second.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to the upstream when a Redis get fails", async () => {
    fakeStore.get.mockRejectedValueOnce(new Error("redis down"));
    const fetchSpy = vi.fn(async () => jsonResponse(happyRaw));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260805" });

    expect(res.status).toBe(200);
    expect(res.body.train_number).toBe(TRAIN_NUMBER);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("caches not-found results so repeat lookups skip the upstream", async () => {
    // A 404 verdict requires every provider to agree, so each upstream gets
    // its own "not found" response. RailYatri only serves today/yesterday.
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://travel.paytm.com")) {
        return jsonResponse({ error: true, status: { result: "failure" } });
      }
      if (url.startsWith("https://rails-ris.makemytrip.com")) {
        return jsonResponse({ success: false, error: {} });
      }
      if (url.startsWith("https://livestatus.railyatri.in")) {
        return jsonResponse({ success: false });
      }
      if (url.startsWith("https://whereismytrain.in")) {
        return jsonResponse({ start_date: "02-08-2026", days_schedule: [] });
      }
      if (url.startsWith("https://www.easemytrip.com")) {
        return new Response(
          "<html><body><h1>Not Found</h1></body></html>",
          { status: 200 },
        );
      }
      return jsonResponse({ success: false });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const now = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const query = { train_number: TRAIN_NUMBER, departure_date: today };
    const first = await request(app).get("/api/trains/status").query(query);
    expect(first.status).toBe(404);
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(fakeStore.data.get(redisKey(today))!.value).toBe("tt:not-found");

    const second = await request(app).get("/api/trains/status").query(query);
    expect(second.status).toBe(404);
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("surfaces upstream failures as 502 even with Redis available", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260807" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Could not reach train data provider" });
    expect(fakeStore.data.size).toBe(0);
  });
});

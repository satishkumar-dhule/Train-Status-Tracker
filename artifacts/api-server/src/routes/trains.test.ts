import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";

const TRAIN_NUMBER = "22943";
const DEPARTURE_DATE = "20260802";

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
      {
        stnSerialNumber: 3,
        stationCode: "CNB",
        stationName: "Kanpur Central",
        arrivalTime: "10:50",
        departureTime: "10:55",
        dayCount: 2,
        distance: 1256,
        expected_platform: 2,
        haltTime: 5,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/trains/status", () => {
  it("returns the mapped status on success", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(happyRaw));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: DEPARTURE_DATE });

    expect(res.status).toBe(200);
    expect(res.body.train_number).toBe(TRAIN_NUMBER);
    expect(res.body.train_name).toBe("Indore Intercity SF Express");
    expect(res.body.stations).toHaveLength(3);
    expect(res.body.stations[1]).toMatchObject({
      station_code: "NDLS",
      delay_minutes: 35,
      is_current: true,
    });
    expect(res.body.current_station_name).toBe("New Delhi");
    expect(res.body.status_message).toBe("Running on time");
  });

  it("serves a repeated request from cache without refetching", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(happyRaw));
    vi.stubGlobal("fetch", fetchSpy);

    const query = { train_number: TRAIN_NUMBER, departure_date: "20260803" };
    const first = await request(app).get("/api/trains/status").query(query);
    const second = await request(app).get("/api/trains/status").query(query);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("rejects query params missing a required field", async () => {
    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("rejects repeated train_number params with a clean error message", async () => {
    const res = await request(app)
      .get("/api/trains/status")
      .query("train_number=1&train_number=2")
      .query({ departure_date: "20260810" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.startsWith("[")).toBe(false);
    expect(res.body.error).toContain("expected string, received array");
  });

  it("rejects a missing departure_date with the param name in the error", async () => {
    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("departure_date: Required");
  });

  it("rejects a departure_date that is not a real calendar date", async () => {
    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20261399" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "departure_date must be a valid date in YYYYMMDD format",
    });
  });

  it("rejects a non-5-digit train_number without touching upstream or cache", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(happyRaw));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: "22943:20260802", departure_date: "20260802" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns 404 when the upstream reports the train as unknown", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: true, status: { result: "failure" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260804" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Train not found or no data available" });
  });

  it("returns 502 when the upstream request fails", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260805" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Could not reach train data provider" });
  });

  it("returns 502 when the upstream responds non-200", async () => {
    const fetchSpy = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260806" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Could not reach train data provider" });
  });

  it("coalesces concurrent requests into a single upstream call", async () => {
    const fetchSpy = vi.fn(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      return jsonResponse(happyRaw);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const query = { train_number: TRAIN_NUMBER, departure_date: "20260807" };
    const [first, second] = await Promise.all([
      request(app).get("/api/trains/status").query(query),
      request(app).get("/api/trains/status").query(query),
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });
});

describe("GET /api/nope", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/api/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

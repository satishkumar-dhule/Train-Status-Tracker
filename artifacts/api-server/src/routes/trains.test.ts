import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";
import { defaultQosRegistry } from "../lib/providers/qos";

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
  defaultQosRegistry.reset();
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
    expect(res.body.provider).toBe("paytm");
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

  it("returns 404 when every provider reports the train as unknown", async () => {
    // Each upstream has its own "not found" shape; a 404 verdict requires all
    // of them to agree (a single errored provider must not poison the cache).
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
        return new Response("<html><body><h1>Train Not Found</h1></body></html>", {
          status: 200,
        });
      }
      return jsonResponse({ success: false });
    });
    vi.stubGlobal("fetch", fetchSpy);

    // RailYatri only serves today/yesterday, so use today for a unanimous 404.
    const now = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: today });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Train not found or no data available" });
  });

  it("returns 502 when a provider errors even if another says not-found", async () => {
    // A single ambiguous/errored provider must not be cached as a 404 marker.
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.startsWith("https://travel.paytm.com")) {
        return jsonResponse({ error: true, status: { result: "failure" } });
      }
      return new Response("boom", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260809" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Could not reach train data provider" });
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

  it("fails over to the next provider when the primary errors", async () => {
    const goibiboBody = {
      success: true,
      response: {
        trainDetails: {
          trainNumber: TRAIN_NUMBER,
          trainName: "Indore Intercity SF Express",
          currentStation: { name: "New Delhi", code: "NDLS" },
        },
        lastUpdated: "06-08-2026 12:54:00",
        stations: [
          {
            Station: { name: "Ahmedabad Jn", code: "ADI", expectedPlatformNumber: 1 },
            HaltMinutes: 20,
            ArrivalDetails: { scheduledArrivalTime: "22:40", actualArrivalTime: "22:40" },
            DepartureDetails: { scheduledDepartureTime: "23:00", actualDepartureTime: "23:00" },
            DayDetails: { dayCount: 1 },
            Distance: 0,
          },
          {
            Station: { name: "New Delhi", code: "NDLS", expectedPlatformNumber: "3" },
            HaltMinutes: 10,
            ArrivalDetails: { scheduledArrivalTime: "08:05", actualArrivalTime: "08:40" },
            DepartureDetails: { scheduledDepartureTime: "08:15", actualDepartureTime: null },
            DayDetails: { dayCount: 2 },
            Distance: 938,
          },
        ],
      },
    };
    const fetchSpy = vi.fn(async (input: string | URL) => {
      if (String(input).startsWith("https://travel.paytm.com")) {
        return new Response("boom", { status: 500 });
      }
      return jsonResponse(goibiboBody);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const now = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: today });

    expect(res.status).toBe(200);
    expect(res.body.train_name).toBe("Indore Intercity SF Express");
    expect(res.body.stations).toHaveLength(2);
    expect(res.body.stations[1]).toMatchObject({
      station_code: "NDLS",
      delay_minutes: 35,
      is_current: true,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

describe("GET /api/trains/status with a pinned provider", () => {
  const goibiboBody = {
    success: true,
    response: {
      trainDetails: {
        trainNumber: TRAIN_NUMBER,
        trainName: "Indore Intercity SF Express",
        currentStation: { name: "New Delhi", code: "NDLS" },
      },
      lastUpdated: "06-08-2026 12:54:00",
      stations: [
        {
          Station: { name: "Ahmedabad Jn", code: "ADI", expectedPlatformNumber: 1 },
          HaltMinutes: 20,
          ArrivalDetails: { scheduledArrivalTime: "22:40", actualArrivalTime: "22:40" },
          DepartureDetails: { scheduledDepartureTime: "23:00", actualDepartureTime: "23:00" },
          DayDetails: { dayCount: 1 },
          Distance: 0,
        },
      ],
    },
  };

  it("pins the lookup to the requested gateway and reports it as the provider", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      if (String(input).startsWith("https://travel.paytm.com")) {
        // A healthy Paytm must be ignored when the user pins Goibibo.
        return new Response("boom", { status: 500 });
      }
      return jsonResponse(goibiboBody);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const now = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: today, provider: "goibibo" });

    expect(res.status).toBe(200);
    expect(res.body.provider).toBe("goibibo");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not fail over when the pinned provider errors", async () => {
    const fetchSpy = vi.fn(async () => new Response("boom", { status: 500 }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260809", provider: "paytm" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Could not reach train data provider" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the pinned provider reports the train as not found", async () => {
    const fetchSpy = vi.fn(async () =>
      jsonResponse({ error: true, status: { result: "failure" } }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260809", provider: "paytm" });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Train not found or no data available" });
  });

  it("rejects an unknown provider name", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(happyRaw));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/status")
      .query({
        train_number: TRAIN_NUMBER,
        departure_date: "20260809",
        provider: "not-a-provider",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid enum value");
    expect(res.body.error).toContain("railradar");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a disabled provider such as RailRadar without a key", async () => {
    const res = await request(app)
      .get("/api/trains/status")
      .query({
        train_number: TRAIN_NUMBER,
        departure_date: "20260809",
        provider: "railradar",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("provider must be one of");
    expect(res.body.error).not.toContain("railradar");
  });

  it("rejects repeated provider params as a validation error", async () => {
    const res = await request(app)
      .get("/api/trains/status")
      .query("provider=paytm&provider=goibibo")
      .query({ train_number: TRAIN_NUMBER, departure_date: "20260809" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("expected string, received array");
  });

  it("caches pinned and auto lookups separately", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      if (String(input).startsWith("https://travel.paytm.com")) {
        return jsonResponse(happyRaw);
      }
      return jsonResponse(goibiboBody);
    });
    vi.stubGlobal("fetch", fetchSpy);

    const query = { train_number: TRAIN_NUMBER, departure_date: "20260808" };
    const auto = await request(app).get("/api/trains/status").query(query);
    const pinned = await request(app)
      .get("/api/trains/status")
      .query({ ...query, provider: "goibibo" });
    const autoAgain = await request(app).get("/api/trains/status").query(query);

    expect(auto.body.provider).toBe("paytm");
    expect(pinned.body.provider).toBe("goibibo");
    expect(autoAgain.body.provider).toBe("paytm");
    // One upstream call for the auto query and one for the pinned query; the
    // repeated auto lookup is served from the per-query cache.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("GET /api/nope", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await request(app).get("/api/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });
});

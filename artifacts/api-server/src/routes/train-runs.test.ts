import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import app from "../app";

function successPayload(): Response {
  return new Response(
    JSON.stringify({
      status: { result: "success" },
      body: { stations: [], current_station: null },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function notFoundPayload(): Response {
  return new Response(
    JSON.stringify({ error: true, status: { result: "failure" } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function weekdayOf(apiDate: string): number {
  return new Date(
    Number(apiDate.slice(0, 4)),
    Number(apiDate.slice(4, 6)) - 1,
    Number(apiDate.slice(6, 8)),
  ).getDay();
}

/** Mock fetch that reports a run only on the given day-of-week indices. */
function stubRunsOn(weekdays: number[]) {
  const fetchSpy = vi.fn(async (input: string | URL) => {
    const url = String(input);
    const date = new URL(url).searchParams.get("departure_date") ?? "";
    return weekdays.includes(weekdayOf(date))
      ? successPayload()
      : notFoundPayload();
  });
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/trains/runs", () => {
  it("returns the last 3 runs plus the next run for a twice-weekly train", async () => {
    stubRunsOn([1, 4]);

    const res = await request(app)
      .get("/api/trains/runs")
      .query({ train_number: "22943" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      train_number: "22943",
      runs: ["20260727", "20260730", "20260803", "20260806"],
    });
  });

  it("returns the last 3 runs plus the next run for a weekly train", async () => {
    stubRunsOn([3]);

    const res = await request(app)
      .get("/api/trains/runs")
      .query({ train_number: "12951" });

    expect(res.status).toBe(200);
    expect(res.body.runs).toEqual([
      "20260722",
      "20260729",
      "20260805",
      "20260812",
    ]);
  });

  it("serves a repeated request from cache without re-probing", async () => {
    const fetchSpy = stubRunsOn([3]);

    const first = await request(app)
      .get("/api/trains/runs")
      .query({ train_number: "12301" });
    const second = await request(app)
      .get("/api/trains/runs")
      .query({ train_number: "12301" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(fetchSpy).toHaveBeenCalledTimes(21);
  });

  it("returns empty runs when the train ran on no probed date", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => notFoundPayload()));

    const res = await request(app)
      .get("/api/trains/runs")
      .query({ train_number: "88888" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ train_number: "88888", runs: [] });
  });

  it("returns 502 when every probe fails upstream", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));

    const res = await request(app)
      .get("/api/trains/runs")
      .query({ train_number: "99999" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Could not reach train data provider" });
  });

  it("rejects a missing train_number", async () => {
    const res = await request(app).get("/api/trains/runs");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("train_number: Required");
  });

  it("rejects a repeated train_number", async () => {
    const res = await request(app)
      .get("/api/trains/runs")
      .query("train_number=1&train_number=2");

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("rejects a non-5-digit train_number without probing upstream", async () => {
    const fetchSpy = vi.fn(async () => successPayload());
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(app)
      .get("/api/trains/runs")
      .query({ train_number: "22943:20260802" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

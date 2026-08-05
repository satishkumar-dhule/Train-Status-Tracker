import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

function notFoundPayload(): Response {
  return new Response(
    JSON.stringify({ error: true, status: { result: "failure" } }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("GET /api/trains/runs rate limiting", () => {
  let app: Express;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("RUNS_RATE_LIMIT_PER_MIN", "3");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => notFoundPayload()),
    );
    ({ default: app } = await import("../app"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows requests up to the per-IP limit", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await request(app)
        .get("/api/trains/runs")
        .query({ train_number: "12345" });
      expect(res.status).toBe(200);
    }
  });

  it("returns 429 with Retry-After and no-store beyond the limit", async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .get("/api/trains/runs")
        .query({ train_number: "12345" });
    }
    const res = await request(app)
      .get("/api/trains/runs")
      .query({ train_number: "12345" });

    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("60");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({ error: "Too many requests" });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";

const NTES_JS = `var arrTrainList = [
"12001- Bhopal Shatabdi Express",
"12002- New Delhi Shatabdi Express",
"12951- Mumbai Rajdhani Express",
"22943- Indore Intercity SF Express"
];`;

function jsResponse(raw: string, status = 200): Response {
  return new Response(raw, {
    status,
    headers: { "Content-Type": "application/javascript" },
  });
}

/** Re-import the app with a fresh module graph so the catalog cache resets. */
async function freshApp(): Promise<Express> {
  vi.resetModules();
  const { default: app } = await import("../app");
  return app;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/trains", () => {
  it("fetches and returns the parsed NTES catalog", async () => {
    const fetchSpy = vi.fn(async () => jsResponse(NTES_JS));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(await freshApp()).get("/api/trains");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      trains: [
        { number: "12001", name: "Bhopal Shatabdi Express" },
        { number: "12002", name: "New Delhi Shatabdi Express" },
        { number: "12951", name: "Mumbai Rajdhani Express" },
        { number: "22943", name: "Indore Intercity SF Express" },
      ],
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("serves a repeated request from the 2h TTL cache without refetching", async () => {
    const fetchSpy = vi.fn(async () => jsResponse(NTES_JS));
    vi.stubGlobal("fetch", fetchSpy);

    const app = await freshApp();
    const first = await request(app).get("/api/trains");
    const second = await request(app).get("/api/trains");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it("fails open to the bundled dataset when the upstream is unreachable", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(await freshApp()).get("/api/trains");

    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBeGreaterThan(0);
  });

  it("fails open to the bundled dataset on a non-200 upstream response", async () => {
    const fetchSpy = vi.fn(async () => jsResponse("boom", 503));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await request(await freshApp()).get("/api/trains");

    expect(res.status).toBe(200);
    expect(res.body.trains.length).toBeGreaterThan(0);
  });
});

describe("GET /api/trains/search", () => {
  it("returns fuzzy matches ranked best-first", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsResponse(NTES_JS)),
    );

    const res = await request(await freshApp())
      .get("/api/trains/search")
      .query({ q: "shatabdi" });

    expect(res.status).toBe(200);
    expect(res.body.results).toContainEqual({
      number: "12001",
      name: "Bhopal Shatabdi Express",
    });
  });

  it("matches duck-typed subsequences", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsResponse(NTES_JS)),
    );

    const res = await request(await freshApp())
      .get("/api/trains/search")
      .query({ q: "rjdn" });

    expect(res.status).toBe(200);
    expect(res.body.results).toContainEqual({
      number: "12951",
      name: "Mumbai Rajdhani Express",
    });
  });

  it("honours the limit param", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsResponse(NTES_JS)),
    );

    const res = await request(await freshApp())
      .get("/api/trains/search")
      .query({ q: "express", limit: 2 });

    expect(res.status).toBe(200);
    expect(res.body.results.length).toBeLessThanOrEqual(2);
  });

  it("rejects a missing q param", async () => {
    const res = await request(await freshApp()).get("/api/trains/search");

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("rejects repeated q params with a clean error message", async () => {
    const res = await request(await freshApp())
      .get("/api/trains/search")
      .query("q=a&q=b");

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("expected string, received array");
  });
});

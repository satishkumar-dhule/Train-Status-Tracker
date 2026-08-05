import { describe, expect, it } from "vitest";
import request from "supertest";
import app, { buildCorsOptions } from "./app";

describe("security headers", () => {
  it("sets hardened headers on data responses", async () => {
    const res = await request(app).get("/api/healthz");
    expect(res.status).toBe(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["strict-transport-security"]).toMatch(/^max-age=\d+/);
  });

  it("marks error responses as non-cacheable", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("error handling", () => {
  it("maps malformed JSON bodies to 400 instead of 500", async () => {
    const res = await request(app)
      .post("/api/nope")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Bad request");
  });

  it("maps oversized bodies to 413 instead of 500", async () => {
    const res = await request(app)
      .post("/api/nope")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ data: "x".repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error).toBe("Payload too large");
  });

  it("keeps unknown internal errors as 500", async () => {
    const res = await request(app)
      .post("/api/nope")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send("a=1");
    expect(res.status).toBe(404);
  });
});

describe("CORS", () => {
  it("reflects an allowed origin in production", () => {
    const options = buildCorsOptions({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.example.com",
    });
    const origin = options.origin as (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => void;
    let allowed = false;
    origin("https://app.example.com", (_e, a) => (allowed = a === true));
    expect(allowed).toBe(true);
  });

  it("denies a non-allowlisted origin in production", () => {
    const options = buildCorsOptions({
      NODE_ENV: "production",
      CORS_ORIGIN: "https://app.example.com",
    });
    const origin = options.origin as (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => void;
    let allowed = true;
    origin("https://evil.example.net", (_e, a) => (allowed = a === true));
    expect(allowed).toBe(false);
  });

  it("denies every cross-origin request in production when no origin is configured", () => {
    const options = buildCorsOptions({ NODE_ENV: "production" });
    const origin = options.origin as (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => void;
    let allowed = true;
    origin("https://app.example.com", (_e, a) => (allowed = a === true));
    expect(allowed).toBe(false);
  });

  it("allows any origin in non-production environments", () => {
    const options = buildCorsOptions({ NODE_ENV: "development" });
    const origin = options.origin as (
      origin: string | undefined,
      cb: (err: Error | null, allow?: boolean) => void,
    ) => void;
    let allowed = false;
    origin("http://localhost:5173", (_e, a) => (allowed = a === true));
    expect(allowed).toBe(true);
  });
});

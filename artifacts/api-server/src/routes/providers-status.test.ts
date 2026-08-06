import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";
import { defaultQosRegistry } from "../lib/providers/qos";

beforeEach(() => {
  defaultQosRegistry.reset();
});

describe("GET /api/trains/providers", () => {
  it("returns a QoS snapshot for every enabled provider", async () => {
    const res = await request(app).get("/api/trains/providers");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.providers)).toBe(true);
    expect(res.body.providers.length).toBeGreaterThan(0);

    const names = res.body.providers.map(
      (provider: { name: string }) => provider.name,
    );
    expect(names).toContain("paytm");
    expect(names).toContain("goibibo");

    for (const provider of res.body.providers) {
      expect(provider).toMatchObject({
        requests: 0,
        successes: 0,
        notFound: 0,
        upstreamErrors: 0,
        timeouts: 0,
        consecutiveFailures: 0,
        status: "ok",
        available: true,
      });
      expect(typeof provider.errorRate).toBe("number");
      expect(typeof provider.avgLatencyMs).toBe("number");
      expect(provider.p95LatencyMs).toBeNull();
    }
  });

  it("reflects recorded provider activity in the snapshot", async () => {
    defaultQosRegistry.record("paytm", {
      outcome: "upstream_error",
      latencyMs: 1200,
      timeout: true,
    });

    const res = await request(app).get("/api/trains/providers");

    const paytm = res.body.providers.find(
      (provider: { name: string }) => provider.name === "paytm",
    );
    expect(paytm).toMatchObject({
      requests: 1,
      upstreamErrors: 1,
      timeouts: 1,
      consecutiveFailures: 1,
    });
  });
});

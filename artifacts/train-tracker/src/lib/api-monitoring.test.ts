import { afterEach, describe, expect, it, vi } from "vitest";
import { getUpcomingDates, toApiDate } from "@workspace/trains-data";
import {
  buildProbes,
  classifyProbe,
  formatBytes,
  formatLatency,
  formatRelativeTime,
  formatStatusCode,
  formatUptime,
  measureBytes,
  runProbes,
  summarizeProbes,
} from "./api-monitoring";
import type { ProbeResult } from "./api-monitoring";

function result(overrides: Partial<ProbeResult>): ProbeResult {
  return {
    id: "health",
    label: "Health",
    method: "GET",
    path: "/api/healthz",
    statusCode: 200,
    latencyMs: 12,
    payloadBytes: 120,
    status: "ok",
    error: null,
    completedAt: 1_700_000_000_000,
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classifyProbe", () => {
  it("returns ok for an expected status", () => {
    expect(classifyProbe(200, new Set([200]))).toBe("ok");
  });

  it("treats an expected 404 as ok (endpoint healthy, data absent)", () => {
    expect(classifyProbe(404, new Set([200, 404]))).toBe("ok");
  });

  it("returns degraded for an unexpected 4xx", () => {
    expect(classifyProbe(400, new Set([200]))).toBe("degraded");
  });

  it("returns down for a 5xx", () => {
    expect(classifyProbe(502, new Set([200]))).toBe("down");
  });

  it("returns down when no response arrived (network/timeout)", () => {
    expect(classifyProbe(null, new Set([200]))).toBe("down");
  });
});

describe("measureBytes", () => {
  it("counts ASCII characters as one byte each", () => {
    expect(measureBytes("hello")).toBe(5);
  });

  it("counts multi-byte UTF-8 characters correctly", () => {
    expect(measureBytes("é")).toBe(2);
    expect(measureBytes("ज")).toBe(3);
  });

  it("serializes JSON payloads to their wire size", () => {
    expect(measureBytes({ a: 1 })).toBe(7); // {"a":1}
  });
});

describe("summarizeProbes", () => {
  it("reports pending for an empty run", () => {
    const summary = summarizeProbes([]);
    expect(summary.overall).toBe("pending");
    expect(summary.total).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.avgLatencyMs).toBeNull();
    expect(summary.maxLatencyMs).toBeNull();
  });

  it("reports ok when every probe is ok and computes rates and latencies", () => {
    const summary = summarizeProbes([
      result({ latencyMs: 10, status: "ok" }),
      result({ id: "catalog", latencyMs: 20, status: "ok" }),
      result({ id: "search", latencyMs: 30, status: "ok" }),
    ]);
    expect(summary.overall).toBe("ok");
    expect(summary.ok).toBe(3);
    expect(summary.degraded).toBe(0);
    expect(summary.down).toBe(0);
    expect(summary.total).toBe(3);
    expect(summary.successRate).toBe(1);
    expect(summary.avgLatencyMs).toBe(20);
    expect(summary.maxLatencyMs).toBe(30);
  });

  it("degrades the whole run when a probe is degraded", () => {
    const summary = summarizeProbes([
      result({ status: "ok" }),
      result({ id: "search", status: "degraded" }),
    ]);
    expect(summary.overall).toBe("degraded");
    expect(summary.successRate).toBe(0.5);
  });

  it("treats any down probe as an overall outage", () => {
    const summary = summarizeProbes([
      result({ status: "ok" }),
      result({ id: "search", status: "degraded" }),
      result({ id: "runs", status: "down" }),
    ]);
    expect(summary.overall).toBe("down");
  });
});

describe("formatters", () => {
  it("formats latencies", () => {
    expect(formatLatency(0)).toBe("0 ms");
    expect(formatLatency(12.4)).toBe("12 ms");
    expect(formatLatency(1_234)).toBe("1.2 s");
  });

  it("formats byte sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(892)).toBe("892 B");
    expect(formatBytes(65_536)).toBe("64.0 KB");
    expect(formatBytes(1_500_000)).toBe("1.4 MB");
  });

  it("formats uptimes", () => {
    expect(formatUptime(45)).toBe("0m 45s");
    expect(formatUptime(3_600)).toBe("1h 0m");
    expect(formatUptime(86_400 * 3 + 3_600 * 4)).toBe("3d 4h");
  });

  it("formats status codes including the ERR placeholder", () => {
    expect(formatStatusCode(200)).toBe("200");
    expect(formatStatusCode(404)).toBe("404");
    expect(formatStatusCode(null)).toBe("ERR");
  });

  it("formats relative times", () => {
    const now = 1_700_000_000_000;
    expect(formatRelativeTime(now, now)).toBe("just now");
    expect(formatRelativeTime(now - 12_000, now)).toBe("12s ago");
    expect(formatRelativeTime(now - 180_000, now)).toBe("3m ago");
  });
});

describe("buildProbes", () => {
  it("defines all six read endpoints", () => {
    const probes = buildProbes(new Date(2026, 7, 9));
    expect(probes.map((probe) => probe.id)).toEqual([
      "health",
      "catalog",
      "search",
      "runs",
      "status",
      "providers",
    ]);
  });

  it("targets the status probe at today's date", () => {
    const today = toApiDate(getUpcomingDates(1, new Date(2026, 7, 9))[0]);
    const status = buildProbes(new Date(2026, 7, 9)).find(
      (probe) => probe.id === "status",
    );
    expect(status?.path).toContain(`departure_date=${today}`);
  });

  it("allows the status probe to answer 404 as healthy", () => {
    const status = buildProbes().find((probe) => probe.id === "status");
    expect(status?.expectedStatuses.has(404)).toBe(true);
  });
});

describe("runProbes", () => {
  it("fans every probe out in parallel and measures latency and payload", async () => {
    const fetchMock = vi.fn(async () => {
      const body = JSON.stringify({ status: "ok", trains: [] });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await runProbes(new Date(2026, 7, 9));

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(snapshot.results).toHaveLength(6);
    expect(snapshot.results.every((probe) => probe.status === "ok")).toBe(true);
    expect(snapshot.results.every((probe) => probe.statusCode === 200)).toBe(
      true,
    );
    expect(
      snapshot.results.every(
        (probe) => probe.latencyMs >= 0 && Number.isFinite(probe.latencyMs),
      ),
    ).toBe(true);
    expect(
      snapshot.results.every((probe) => probe.payloadBytes > 0),
    ).toBe(true);
    expect(snapshot.generatedAt).toBeGreaterThan(0);
  });

  it("parses health, catalog count, and providers from their probe bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body =
          url.includes("/healthz")
            ? JSON.stringify({
                status: "ok",
                redis: "up",
                uptime_seconds: 3661,
                version: "0.1.0",
                timestamp: "2026-08-09T00:00:00.000Z",
              })
            : url.includes("/api/trains/")
              ? JSON.stringify({ results: [] })
              : JSON.stringify({ providers: [] });
        return new Response(body, { status: 200 });
      }),
    );

    const snapshot = await runProbes(new Date(2026, 7, 9));
    expect(snapshot.health?.status).toBe("ok");
    expect(snapshot.health?.redis).toBe("up");
    expect(snapshot.health?.uptime_seconds).toBe(3661);
    expect(snapshot.catalogCount).not.toBeNull();
    expect(snapshot.providers).toEqual([]);
  });

  it("records a 404 status probe as ok with the API's error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ error: "Train not found or no data available" }), {
          status: 404,
        }),
      ),
    );

    const snapshot = await runProbes(new Date(2026, 7, 9));
    const status = snapshot.results.find((probe) => probe.id === "status");
    expect(status?.statusCode).toBe(404);
    expect(status?.status).toBe("ok");
    expect(status?.error).toBe("Train not found or no data available");
  });

  it("marks a probe down when the endpoint never responds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("TypeError: Failed to fetch");
      }),
    );

    const snapshot = await runProbes(new Date(2026, 7, 9));
    expect(
      snapshot.results.every((probe) => probe.status === "down"),
    ).toBe(true);
    expect(
      snapshot.results.every((probe) => probe.statusCode === null),
    ).toBe(true);
    expect(snapshot.results[0].error).toBe("Network or timeout error");
  });

  it("marks an unexpected 5xx as down but an expected 404 as ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const status = url.includes("/healthz") ? 500 : 200;
        return new Response(JSON.stringify({ error: "boom" }), { status });
      }),
    );

    const snapshot = await runProbes(new Date(2026, 7, 9));
    const health = snapshot.results.find((probe) => probe.id === "health");
    expect(health?.status).toBe("down");
    expect(snapshot.results.filter((probe) => probe.status === "ok").length).toBe(5);
    expect(health?.error).toBe("boom");
  });

  it("times each probe out instead of hanging the cycle", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          // Never resolves; honors the caller's abort signal like a real fetch.
          const signal = init.signal;
          if (signal) {
            if (signal.aborted) reject(signal.reason);
            else
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
          }
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await runProbes(
      new Date(2026, 7, 9),
      50 /* timeoutMs */,
    );
    expect(snapshot.results.every((probe) => probe.status === "down")).toBe(true);
  });
});

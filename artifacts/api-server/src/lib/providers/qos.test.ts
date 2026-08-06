import { describe, expect, it } from "vitest";
import { QosRegistry } from "./qos";

describe("QosRegistry", () => {
  it("starts empty and reports healthy for unknown providers", () => {
    const qos = new QosRegistry();

    expect(qos.isAvailable("paytm")).toBe(true);
    const snapshot = qos.snapshot("paytm");
    expect(snapshot.requests).toBe(0);
    expect(snapshot.status).toBe("ok");
    expect(snapshot.available).toBe(true);
    expect(snapshot.errorRate).toBe(0);
  });

  it("tracks successes and resets consecutive failures", () => {
    const qos = new QosRegistry();
    qos.record("a", { outcome: "upstream_error", latencyMs: 100 });
    qos.record("a", { outcome: "upstream_error", latencyMs: 100 });
    qos.record("a", { outcome: "success", latencyMs: 50 });

    const snapshot = qos.snapshot("a");
    expect(snapshot.requests).toBe(3);
    expect(snapshot.successes).toBe(1);
    expect(snapshot.upstreamErrors).toBe(2);
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.lastSuccessAt).not.toBeNull();
  });

  it("treats not-found as a healthy authoritative answer", () => {
    const qos = new QosRegistry();
    qos.record("a", { outcome: "not_found", latencyMs: 200 });

    const snapshot = qos.snapshot("a");
    expect(snapshot.notFound).toBe(1);
    expect(snapshot.consecutiveFailures).toBe(0);
    expect(snapshot.available).toBe(true);
    expect(snapshot.status).toBe("ok");
  });

  it("computes error rate and degrades status on repeated failures", () => {
    const qos = new QosRegistry();
    qos.record("a", { outcome: "upstream_error", latencyMs: 10 });
    qos.record("a", { outcome: "upstream_error", latencyMs: 10 });
    qos.record("a", { outcome: "success", latencyMs: 10 });

    const snapshot = qos.snapshot("a");
    expect(snapshot.errorRate).toBeCloseTo(2 / 3);
    expect(snapshot.status).toBe("degraded");
  });

  it("marks a provider down after the failure threshold", () => {
    const qos = new QosRegistry({
      failureThreshold: 3,
      cooldownMs: 60_000,
      maxLatencySamples: 10,
    });

    qos.record("a", { outcome: "upstream_error", latencyMs: 10 });
    qos.record("a", { outcome: "upstream_error", latencyMs: 10 });
    expect(qos.isAvailable("a")).toBe(true);

    qos.record("a", { outcome: "upstream_error", latencyMs: 10 });
    expect(qos.isAvailable("a")).toBe(false);
    expect(qos.snapshot("a").status).toBe("down");
  });

  it("reopens a provider after the cooldown elapses", () => {
    const qos = new QosRegistry({
      failureThreshold: 1,
      cooldownMs: 60_000,
      maxLatencySamples: 10,
    });

    qos.record("a", { outcome: "upstream_error", latencyMs: 10 });
    const failedAt = Date.parse(qos.snapshot("a").lastErrorAt!);

    expect(qos.isAvailable("a", failedAt)).toBe(false);
    expect(qos.isAvailable("a", failedAt + 60_000)).toBe(true);
  });

  it("computes avg and p95 latency from the rolling window", () => {
    const qos = new QosRegistry();
    for (let i = 1; i <= 20; i += 1) {
      qos.record("a", { outcome: "success", latencyMs: i });
    }

    const snapshot = qos.snapshot("a");
    expect(snapshot.avgLatencyMs).toBeCloseTo(10.5);
    expect(snapshot.p95LatencyMs).toBe(19);
  });

  it("caps the latency window at maxLatencySamples", () => {
    const qos = new QosRegistry({ maxLatencySamples: 3 });
    for (let i = 1; i <= 5; i += 1) {
      qos.record("a", { outcome: "success", latencyMs: i });
    }

    const snapshot = qos.snapshot("a");
    expect(snapshot.avgLatencyMs).toBeCloseTo(4);
    expect(snapshot.p95LatencyMs).toBe(5);
  });

  it("counts timeouts separately", () => {
    const qos = new QosRegistry();
    qos.record("a", {
      outcome: "upstream_error",
      latencyMs: 10_000,
      timeout: true,
    });

    const snapshot = qos.snapshot("a");
    expect(snapshot.timeouts).toBe(1);
    expect(snapshot.upstreamErrors).toBe(1);
  });

  it("snapshots for a list of names in order", () => {
    const qos = new QosRegistry();
    qos.record("b", { outcome: "success", latencyMs: 1 });
    qos.record("a", { outcome: "success", latencyMs: 2 });

    const snapshots = qos.snapshotFor(["a", "b", "c"]);
    expect(snapshots.map((s) => s.name)).toEqual(["a", "b", "c"]);
    expect(snapshots[2].requests).toBe(0);
  });

  it("reset clears all recorded state", () => {
    const qos = new QosRegistry();
    qos.record("a", { outcome: "upstream_error", latencyMs: 10 });
    expect(qos.snapshotAll()).toHaveLength(1);

    qos.reset();
    expect(qos.snapshotAll()).toHaveLength(0);
    expect(qos.isAvailable("a")).toBe(true);
  });
});

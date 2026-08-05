import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createRedisHealth,
  type RedisHealthClientLike,
} from "./redis-client";

type Listener = (...args: unknown[]) => void;

class FakeRedis implements RedisHealthClientLike {
  status = "wait";
  connectCalls = 0;
  shouldConnect = true;
  readonly connectError = new Error("ECONNREFUSED");
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, cb: Listener): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb);
    return this;
  }

  off(event: string, cb: Listener): this {
    this.listeners.get(event)?.delete(cb);
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => cb(...args));
  }

  async connect(): Promise<void> {
    this.connectCalls += 1;
    if (!this.shouldConnect) {
      this.status = "end";
      this.emit("end");
      throw this.connectError;
    }
    this.status = "ready";
    this.emit("ready");
  }

  dispose(): void {
    this.listeners.clear();
  }
}

const PROBE_MS = 15 * 60 * 1000;

describe("createRedisHealth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts unhealthy and becomes healthy on ready", () => {
    const client = new FakeRedis();
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: true,
    });
    expect(health.isHealthy()).toBe(false);
    client.emit("ready");
    expect(health.isHealthy()).toBe(true);
  });

  it("marks unhealthy on close and error", () => {
    const client = new FakeRedis();
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: true,
    });
    client.emit("ready");
    expect(health.isHealthy()).toBe(true);

    client.emit("close");
    expect(health.isHealthy()).toBe(false);

    client.emit("ready");
    expect(health.isHealthy()).toBe(true);

    client.emit("error", new Error("timeout"));
    expect(health.isHealthy()).toBe(false);
  });

  it("reconnects after the re-probe interval when Redis returns (auto mode)", async () => {
    const client = new FakeRedis();
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: true,
    });
    client.emit("ready");
    expect(health.isHealthy()).toBe(true);

    client.emit("end");
    expect(health.isHealthy()).toBe(false);
    expect(client.connectCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(PROBE_MS - 1);
    expect(client.connectCalls).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(client.connectCalls).toBe(1);
    expect(client.status).toBe("ready");
    expect(health.isHealthy()).toBe(true);
  });

  it("stays unhealthy and re-probes again while Redis stays down", async () => {
    const client = new FakeRedis();
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: true,
    });
    client.emit("end");
    client.shouldConnect = false;

    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(client.connectCalls).toBe(1);
    expect(health.isHealthy()).toBe(false);

    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(client.connectCalls).toBe(2);
    expect(health.isHealthy()).toBe(false);

    client.shouldConnect = true;
    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(client.connectCalls).toBe(3);
    expect(health.isHealthy()).toBe(true);
  });

  it("does not schedule re-probes when autoRecheck is disabled", async () => {
    const client = new FakeRedis();
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: false,
    });
    client.emit("end");

    await vi.advanceTimersByTimeAsync(PROBE_MS * 3);
    expect(client.connectCalls).toBe(0);
    expect(health.isHealthy()).toBe(false);
    health.dispose();
  });

  it("treats an already-ready client during a probe as healthy", async () => {
    const client = new FakeRedis();
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: true,
    });
    client.emit("end");
    client.emit("ready");
    // Recovery before the timer fires must cancel the pending probe.
    await vi.advanceTimersByTimeAsync(PROBE_MS * 2);
    expect(client.connectCalls).toBe(0);
    expect(health.isHealthy()).toBe(true);
    health.dispose();
  });

  it("does not schedule duplicate probes when unhealthy events fire while one is pending", async () => {
    const client = new FakeRedis();
    client.shouldConnect = false;
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: true,
    });
    client.emit("end");
    // error/close must not spawn extra timers.
    client.emit("error", new Error("timeout"));
    client.emit("close");

    await vi.advanceTimersByTimeAsync(PROBE_MS);
    expect(client.connectCalls).toBe(1);

    // Recovery via ready cancels the next scheduled probe.
    client.emit("ready");
    await vi.advanceTimersByTimeAsync(PROBE_MS * 2);
    expect(client.connectCalls).toBe(1);
    expect(health.isHealthy()).toBe(true);
    health.dispose();
  });

  it("stops probing and unsubscribes after dispose", async () => {
    const client = new FakeRedis();
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: true,
    });
    client.emit("ready");
    expect(health.isHealthy()).toBe(true);

    health.dispose();
    // After dispose the controller no longer reacts to client events.
    client.emit("end");
    expect(health.isHealthy()).toBe(true);

    await vi.advanceTimersByTimeAsync(PROBE_MS * 2);
    expect(client.connectCalls).toBe(0);
  });

  it("removes the close and error listeners on dispose", () => {
    const client = new FakeRedis();
    const health = createRedisHealth(client, {
      probeIntervalMs: PROBE_MS,
      autoRecheck: true,
    });
    client.emit("ready");
    expect(health.isHealthy()).toBe(true);

    health.dispose();
    client.emit("close");
    expect(health.isHealthy()).toBe(true);
    client.emit("error", new Error("timeout"));
    expect(health.isHealthy()).toBe(true);
  });
});

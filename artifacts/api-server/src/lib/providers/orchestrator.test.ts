import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { metrics, type Counter, type Histogram, type Meter } from "@opentelemetry/api";
import type { MappedStatus } from "../train-status-mapper";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import { fetchStatusWithFailover } from "./orchestrator";
import { defaultQosRegistry, QosRegistry } from "./qos";
import type { TrainStatusProvider } from "./types";

const counterAdds: Array<{
  name: string;
  value: number;
  attributes: Record<string, string | number>;
}> = [];
metrics.setGlobalMeterProvider({
  getMeter: (): Meter =>
    ({
      createCounter: (name: string): Counter => ({
        add: (value: number, attributes?: Record<string, string | number>) => {
          counterAdds.push({ name, value, attributes: attributes ?? {} });
        },
      }),
      createHistogram: (name: string): Histogram => ({
        record: (
          _value: number,
          _attributes?: Record<string, string | number>,
        ) => {},
      }),
    }) as Meter,
});

beforeEach(() => {
  counterAdds.length = 0;
});

function mappedStatus(trainName: string): MappedStatus {
  return {
    train_number: "22943",
    train_name: trainName,
    departure_date: "20260802",
    source_station_code: "ADI",
    source_station_name: "",
    destination_station_code: "NDLS",
    destination_station_name: "",
    current_station_code: null,
    current_station_name: null,
    current_delay_minutes: null,
    status_message: null,
    last_updated: null,
    stations: [],
  };
}

function makeProvider(
  name: string,
  behavior: {
    result?: MappedStatus;
    notFound?: boolean;
    upstreamError?: boolean;
    throwGeneric?: boolean;
  } = {},
): TrainStatusProvider {
  return {
    name,
    enabled: true,
    fetchTrainStatus: vi.fn(async () => {
      if (behavior.throwGeneric) throw new Error("programming bug");
      if (behavior.notFound) {
        throw new TrainStatusNotFoundError(name, "nope");
      }
      if (behavior.upstreamError) {
        throw new TrainStatusUpstreamError(name, "boom");
      }
      return behavior.result ?? mappedStatus(`from ${name}`);
    }),
  };
}

afterEach(() => {
  defaultQosRegistry.reset();
});

describe("fetchStatusWithFailover", () => {
  it("returns the first successful provider", async () => {
    const paytm = makeProvider("paytm", { upstreamError: true });
    const goibibo = makeProvider("goibibo", {
      result: mappedStatus("from goibibo"),
    });
    const railyatri = makeProvider("railyatri");

    const status = await fetchStatusWithFailover(
      [paytm, goibibo, railyatri],
      "22943",
      "20260802",
    );

    expect(status.train_name).toBe("from goibibo");
    expect(paytm.fetchTrainStatus).toHaveBeenCalledWith(
      "22943",
      "20260802",
      expect.objectContaining({}),
      null,
    );
    expect(goibibo.fetchTrainStatus).toHaveBeenCalledTimes(1);
    expect(railyatri.fetchTrainStatus).not.toHaveBeenCalled();
  });

  it("throws not-found only when every provider reports not-found", async () => {
    const a = makeProvider("a", { notFound: true });
    const b = makeProvider("b", { notFound: true });

    await expect(
      fetchStatusWithFailover([a, b], "22943", "20260802"),
    ).rejects.toThrow(TrainStatusNotFoundError);
  });

  it("records a failover metric when a later provider recovers", async () => {
    const a = makeProvider("a", { upstreamError: true });
    const b = makeProvider("b");

    const status = await fetchStatusWithFailover([a, b], "22943", "20260802");

    expect(status.train_name).toBe("from b");
    const recorded = counterAdds.find(
      (c) => c.name === "app.provider.failover",
    );
    expect(recorded).toEqual({
      name: "app.provider.failover",
      value: 1,
      attributes: { outcome: "recovered", attempts: 2 },
    });
  });

  it("records a failover metric when every provider reports not-found", async () => {
    const a = makeProvider("a", { notFound: true });
    const b = makeProvider("b", { notFound: true });

    await expect(
      fetchStatusWithFailover([a, b], "22943", "20260802"),
    ).rejects.toThrow(TrainStatusNotFoundError);

    const recorded = counterAdds.find(
      (c) => c.name === "app.provider.failover",
    );
    expect(recorded?.attributes).toEqual({
      outcome: "not_found",
      attempts: 2,
    });
  });

  it("throws an upstream error when one provider errors and another says not-found", async () => {
    const a = makeProvider("a", { upstreamError: true });
    const b = makeProvider("b", { notFound: true });

    await expect(
      fetchStatusWithFailover([a, b], "22943", "20260802"),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("throws an upstream error when every provider errors", async () => {
    const a = makeProvider("a", { upstreamError: true });
    const b = makeProvider("b", { upstreamError: true });

    await expect(
      fetchStatusWithFailover([a, b], "22943", "20260802"),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("skips disabled providers", async () => {
    const disabled: TrainStatusProvider = {
      name: "x",
      enabled: false,
      fetchTrainStatus: vi.fn(),
    };
    const enabled = makeProvider("y");

    const status = await fetchStatusWithFailover(
      [disabled, enabled],
      "22943",
      "20260802",
    );

    expect(status.train_name).toBe("from y");
    expect(disabled.fetchTrainStatus).not.toHaveBeenCalled();
  });

  it("rethrows a programming error without masking it", async () => {
    const a = makeProvider("a", { throwGeneric: true });
    const b = makeProvider("b");

    await expect(
      fetchStatusWithFailover([a, b], "22943", "20260802"),
    ).rejects.toThrow("programming bug");
  });

  it("throws an upstream error when no providers are enabled", async () => {
    const disabled: TrainStatusProvider = {
      name: "x",
      enabled: false,
      fetchTrainStatus: vi.fn(),
    };

    await expect(
      fetchStatusWithFailover([disabled], "22943", "20260802"),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("passes through fetch options and known train", async () => {
    const provider = makeProvider("a");
    const controller = new AbortController();
    const knownTrain = { number: "22943", name: "Bandra Gujarat Express" };

    await fetchStatusWithFailover([provider], "22943", "20260802", {
      fetchOptions: { signal: controller.signal },
      knownTrain,
    });

    expect(provider.fetchTrainStatus).toHaveBeenCalledWith(
      "22943",
      "20260802",
      expect.objectContaining({ signal: controller.signal }),
      knownTrain,
    );
  });

  it("records a timeout in the QoS registry when the upstream timed out", async () => {
    const qos = new QosRegistry();
    const a: TrainStatusProvider = {
      name: "a",
      enabled: true,
      fetchTrainStatus: vi.fn(async () => {
        throw new TrainStatusUpstreamError("a", "Network error reaching a", {
          cause: new DOMException("The operation timed out", "TimeoutError"),
        });
      }),
    };

    await expect(
      fetchStatusWithFailover([a], "22943", "20260802", { qos }),
    ).rejects.toThrow(TrainStatusUpstreamError);

    const snapshot = qos.snapshot("a");
    expect(snapshot.upstreamErrors).toBe(1);
    expect(snapshot.timeouts).toBe(1);
    expect(snapshot.consecutiveFailures).toBe(1);
  });

  it("records a success in the QoS registry", async () => {
    const qos = new QosRegistry();
    const a = makeProvider("a");

    await fetchStatusWithFailover([a], "22943", "20260802", { qos });

    const snapshot = qos.snapshot("a");
    expect(snapshot.successes).toBe(1);
    expect(snapshot.upstreamErrors).toBe(0);
    expect(snapshot.consecutiveFailures).toBe(0);
  });

  it("skips a provider in QoS cooldown and uses the next one", async () => {
    const qos = new QosRegistry({
      failureThreshold: 1,
      cooldownMs: 60_000,
      maxLatencySamples: 10,
    });
    const a = makeProvider("a", { upstreamError: true });
    const b = makeProvider("b");

    const status = await fetchStatusWithFailover([a, b], "22943", "20260802", {
      qos,
    });
    expect(status.train_name).toBe("from b");

    await fetchStatusWithFailover([a, b], "22943", "20260802", { qos });

    expect(a.fetchTrainStatus).toHaveBeenCalledTimes(1);
    expect(b.fetchTrainStatus).toHaveBeenCalledTimes(2);
  });

  it("force-tries the first provider when every provider is in cooldown", async () => {
    const qos = new QosRegistry({
      failureThreshold: 1,
      cooldownMs: 60_000,
      maxLatencySamples: 10,
    });
    const a = makeProvider("a", { upstreamError: true });
    const b = makeProvider("b", { upstreamError: true });

    await expect(
      fetchStatusWithFailover([a, b], "22943", "20260802", { qos }),
    ).rejects.toThrow(TrainStatusUpstreamError);
    await expect(
      fetchStatusWithFailover([a, b], "22943", "20260802", { qos }),
    ).rejects.toThrow(TrainStatusUpstreamError);

    expect(a.fetchTrainStatus).toHaveBeenCalledTimes(2);
    expect(b.fetchTrainStatus).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  buildProbeDates,
  computeRunDates,
  mapLimited,
  probeTrainRuns,
} from "./train-runs";

const NOW = new Date(2026, 7, 5);

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

describe("buildProbeDates", () => {
  it("returns the trailing 3-week window ending today, ascending", () => {
    expect(buildProbeDates(20, NOW)).toHaveLength(21);
    expect(buildProbeDates(20, NOW)[0]).toBe("20260716");
    expect(buildProbeDates(20, NOW).at(-1)).toBe("20260805");
  });

  it("crosses month boundaries", () => {
    const jan2 = new Date(2026, 0, 2);
    expect(buildProbeDates(2, jan2)).toEqual(["20251231", "20260101", "20260102"]);
  });
});

describe("mapLimited", () => {
  it("preserves input order and bounds concurrency", async () => {
    let active = 0;
    let maxActive = 0;
    const fn = async (n: number): Promise<number> => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return n * 2;
    };

    const result = await mapLimited([1, 2, 3, 4, 5, 6, 7], 3, fn);
    expect(result).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("handles an empty input", async () => {
    await expect(mapLimited([], 3, async () => 1)).resolves.toEqual([]);
  });
});

describe("probeTrainRuns", () => {
  it("derives the running-weekday pattern from probed dates", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const date = new URL(url).searchParams.get("departure_date") ?? "";
      return [1, 4].includes(weekdayOf(date)) ? successPayload() : notFoundPayload();
    });

    const result = await probeTrainRuns("22943", { fetchImpl: fetchSpy, now: NOW });

    expect(result.weekdays).toEqual([1, 4]);
    expect(result.observedRuns).toEqual([
      "20260716",
      "20260720",
      "20260723",
      "20260727",
      "20260730",
      "20260803",
    ]);
    expect(result.upstreamFailures).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(21);
  });

  it("counts upstream failures instead of failing the probe", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const date = new URL(url).searchParams.get("departure_date") ?? "";
      if (weekdayOf(date) === 1) throw new TypeError("network down");
      return weekdayOf(date) === 4 ? successPayload() : notFoundPayload();
    });

    const result = await probeTrainRuns("22943", { fetchImpl: fetchSpy, now: NOW });

    expect(result.weekdays).toEqual([4]);
    expect(result.observedRuns).toEqual(["20260716", "20260723", "20260730"]);
    expect(result.upstreamFailures).toBe(3);
  });

  it("records no runs when every probe is not-found", async () => {
    const fetchSpy = vi.fn(async () => notFoundPayload());

    const result = await probeTrainRuns("22943", { fetchImpl: fetchSpy, now: NOW });

    expect(result.weekdays).toEqual([]);
    expect(result.observedRuns).toEqual([]);
    expect(result.upstreamFailures).toBe(0);
  });
});

describe("computeRunDates", () => {
  it("returns last 3 + next for a weekly train (same weekday as today)", () => {
    expect(computeRunDates([3], { now: NOW })).toEqual([
      "20260722",
      "20260729",
      "20260805",
      "20260812",
    ]);
  });

  it("returns last 3 + next for a twice-weekly train", () => {
    expect(computeRunDates([1, 4], { now: NOW })).toEqual([
      "20260727",
      "20260730",
      "20260803",
      "20260806",
    ]);
  });

  it("returns last 3 + next for a daily train", () => {
    expect(
      computeRunDates([0, 1, 2, 3, 4, 5, 6], { now: NOW }),
    ).toEqual(["20260803", "20260804", "20260805", "20260806"]);
  });

  it("returns fewer than 3 past runs with a short window", () => {
    expect(
      computeRunDates([3], { now: NOW, windowDays: 1 }),
    ).toEqual(["20260805", "20260812"]);
  });

  it("returns an empty array for an unknown pattern", () => {
    expect(computeRunDates([], { now: NOW })).toEqual([]);
  });
});

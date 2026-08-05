import { describe, expect, it, vi } from "vitest";
import {
  buildProbeDates,
  computeRunDates,
  mapLimited,
  parseScheduleWeekdays,
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

function scheduleNotePayload(days: string): Response {
  return new Response(
    JSON.stringify({
      status: { result: "success" },
      body: {
        stations: [],
        current_station: null,
        train_status_message: `This train runs only on ${days}`,
      },
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

  it("excludes a weekday that ran on only a minority of its probes", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const date = new URL(url).searchParams.get("departure_date") ?? "";
      const weekday = weekdayOf(date);
      if (weekday === 1) return successPayload();
      if (weekday === 2 && date === "20260728") return successPayload();
      return notFoundPayload();
    });

    const result = await probeTrainRuns("22943", { fetchImpl: fetchSpy, now: NOW });

    expect(result.weekdays).toEqual([1]);
    expect(result.observedRuns).toEqual([
      "20260720",
      "20260727",
      "20260728",
      "20260803",
    ]);
    expect(result.upstreamFailures).toBe(0);
  });

  it("keeps a weekday whose runs outnumber its not-run probes", async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const date = new URL(url).searchParams.get("departure_date") ?? "";
      const weekday = weekdayOf(date);
      if (weekday === 4) return successPayload();
      if (weekday === 5 && date !== "20260725") return successPayload();
      return notFoundPayload();
    });

    const result = await probeTrainRuns("22943", { fetchImpl: fetchSpy, now: NOW });

    expect(result.weekdays).toEqual([4, 5]);
    expect(result.upstreamFailures).toBe(0);
  });

  it("trusts the schedule note over probe outcomes and restores failed real run days", async () => {
    // Mirrors train 12435: runs Mon/Fri. Past Fridays return "not found"
    // (provider lacks data), Mon returns a genuine run, and the other days
    // answer success carrying the fallback schedule note.
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = String(input);
      const date = new URL(url).searchParams.get("departure_date") ?? "";
      const weekday = weekdayOf(date);
      if (weekday === 1) return successPayload();
      if (weekday === 5) return notFoundPayload();
      if (weekday === 2 || weekday === 3 || weekday === 6) {
        return scheduleNotePayload("MON,FRI");
      }
      return notFoundPayload();
    });

    const result = await probeTrainRuns("12435", {
      fetchImpl: fetchSpy,
      now: NOW,
    });

    expect(result.weekdays).toEqual([1, 5]);
    expect(result.scheduleWeekdays).toEqual([1, 5]);
    expect(result.observedRuns).toEqual(["20260720", "20260727", "20260803"]);
    expect(result.upstreamFailures).toBe(0);
  });

  it("records no runs when every probe is not-found", async () => {
    const fetchSpy = vi.fn(async () => notFoundPayload());

    const result = await probeTrainRuns("22943", { fetchImpl: fetchSpy, now: NOW });

    expect(result.weekdays).toEqual([]);
    expect(result.observedRuns).toEqual([]);
    expect(result.upstreamFailures).toBe(0);
  });
});

describe("parseScheduleWeekdays", () => {
  it("parses a comma-separated schedule note", () => {
    expect(
      parseScheduleWeekdays("This train runs only on MON,FRI"),
    ).toEqual([1, 5]);
  });

  it("tolerates spaces around the day tokens", () => {
    expect(
      parseScheduleWeekdays("This train runs only on MON, WED, SAT"),
    ).toEqual([1, 3, 6]);
  });

  it("returns null for a live status message", () => {
    expect(parseScheduleWeekdays("Train has reached destination.")).toBeNull();
    expect(parseScheduleWeekdays("Train hasn\u2019t started from the originating station")).toBeNull();
  });

  it("returns null when a day token is unrecognized", () => {
    expect(parseScheduleWeekdays("This train runs only on MON,XYZ")).toBeNull();
  });

  it("returns null for an empty message", () => {
    expect(parseScheduleWeekdays(null)).toBeNull();
    expect(parseScheduleWeekdays(undefined)).toBeNull();
    expect(parseScheduleWeekdays("")).toBeNull();
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

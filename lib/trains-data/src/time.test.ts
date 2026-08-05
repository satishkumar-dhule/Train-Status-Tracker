import { describe, expect, it } from "vitest";
import {
  calcDelay,
  formatDuration,
  formatShortDate,
  fromApiDate,
  getUpcomingDates,
  getDateWindow,
  isValidApiDate,
  isValidDepartureDate,
  pickDefaultRunDate,
  toApiDate,
  toMinutes,
} from "./time";

describe("toMinutes", () => {
  it("parses HH:MM", () => {
    expect(toMinutes("08:30")).toBe(510);
    expect(toMinutes("00:05")).toBe(5);
    expect(toMinutes("23:59")).toBe(1439);
  });

  it("returns null for malformed input", () => {
    expect(toMinutes(null)).toBeNull();
    expect(toMinutes(undefined)).toBeNull();
    expect(toMinutes("")).toBeNull();
    expect(toMinutes("8")).toBeNull();
    expect(toMinutes("08:30:00")).toBeNull();
    expect(toMinutes("abc")).toBeNull();
  });
});

describe("calcDelay", () => {
  it("computes a positive delay", () => {
    expect(calcDelay("08:00", "08:20")).toBe(20);
  });

  it("computes a negative delay (early arrival)", () => {
    expect(calcDelay("08:20", "08:00")).toBe(-20);
  });

  it("handles midnight roll-over (scheduled 23:50, actual 00:10)", () => {
    expect(calcDelay("23:50", "00:10")).toBe(20);
  });

  it("handles roll-over in the other direction", () => {
    expect(calcDelay("00:10", "23:50")).toBe(-20);
  });

  it("returns null when either time is missing", () => {
    expect(calcDelay(null, "08:00")).toBeNull();
    expect(calcDelay("08:00", null)).toBeNull();
  });
});

describe("date helpers", () => {
  it("isValidDepartureDate rejects malformed/nonexistent dates", () => {
    expect(isValidDepartureDate("2026-13-01")).toBe(false);
    expect(isValidDepartureDate("2026-00-10")).toBe(false);
    expect(isValidDepartureDate("2026-02-30")).toBe(false);
    expect(isValidDepartureDate("not-a-date")).toBe(false);
  });

  it("isValidDepartureDate requires today or later", () => {
    const now = new Date(2026, 7, 5);
    expect(isValidDepartureDate("2026-08-05", now)).toBe(true);
    expect(isValidDepartureDate("2026-08-06", now)).toBe(true);
    expect(isValidDepartureDate("2026-08-04", now)).toBe(false);
  });

  it("isValidApiDate accepts only real YYYYMMDD dates", () => {
    expect(isValidApiDate("20260805")).toBe(true);
    expect(isValidApiDate("20261399")).toBe(false);
    expect(isValidApiDate("20260230")).toBe(false);
    expect(isValidApiDate("2026085")).toBe(false);
    expect(isValidApiDate("abcd")).toBe(false);
  });

  it("toApiDate strips dashes", () => {
    expect(toApiDate("2026-08-05")).toBe("20260805");
  });

  it("fromApiDate inserts dashes", () => {
    expect(fromApiDate("20260805")).toBe("2026-08-05");
    expect(fromApiDate("garbage")).toBe("garbage");
    expect(fromApiDate("2026085")).toBe("2026085");
  });

  it("pickDefaultRunDate prefers today when it is a run", () => {
    const now = new Date(2026, 7, 5);
    expect(pickDefaultRunDate(["20260803", "20260805", "20260812"], now)).toBe(
      "20260805",
    );
  });

  it("pickDefaultRunDate falls back to the most recent past run", () => {
    const now = new Date(2026, 7, 5);
    expect(pickDefaultRunDate(["20260804", "20260806"], now)).toBe("20260804");
  });

  it("pickDefaultRunDate falls back to the next run when none are past", () => {
    const now = new Date(2026, 7, 5);
    expect(pickDefaultRunDate(["20260806"], now)).toBe("20260806");
  });

  it("pickDefaultRunDate returns null without runs", () => {
    expect(pickDefaultRunDate([], new Date(2026, 7, 5))).toBeNull();
  });

  it("getUpcomingDates returns N consecutive local dates", () => {
    const now = new Date(2026, 7, 5);
    expect(getUpcomingDates(0, now)).toEqual([]);
    expect(getUpcomingDates(3, now)).toEqual([
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
    ]);
    // wraps month/year correctly
    const eoy = new Date(2026, 11, 31);
    expect(getUpcomingDates(2, eoy)).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("getDateWindow returns a symmetric window centered on today", () => {
    const now = new Date(2026, 7, 5);
    expect(getDateWindow(3, 3, now)).toEqual([
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
      "2026-08-05",
      "2026-08-06",
      "2026-08-07",
      "2026-08-08",
    ]);
    expect(getDateWindow(0, 0, now)).toEqual(["2026-08-05"]);
    expect(getDateWindow(1, 0, now)).toEqual(["2026-08-04", "2026-08-05"]);
  });

  it("getDateWindow crosses month and year boundaries", () => {
    const now = new Date(2026, 0, 2);
    expect(getDateWindow(3, 3, now)).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
      "2026-01-05",
    ]);
  });

  it("getDateWindow rejects negative ranges", () => {
    const now = new Date(2026, 7, 5);
    expect(getDateWindow(-1, 3, now)).toEqual([]);
    expect(getDateWindow(3, -1, now)).toEqual([]);
  });
});

describe("formatShortDate", () => {
  it("formats as 'd Mon'", () => {
    expect(formatShortDate("2026-08-02")).toBe("2 Aug");
  });

  it("returns input unchanged when malformed", () => {
    expect(formatShortDate("garbage")).toBe("garbage");
    expect(formatShortDate("2026-13-40")).toBe("2026-13-40");
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(480)).toBe("8h");
    expect(formatDuration(510)).toBe("8h 30m");
  });

  it("handles invalid input", () => {
    expect(formatDuration(-1)).toBe("--");
    expect(formatDuration(Number.NaN)).toBe("--");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("--");
  });
});

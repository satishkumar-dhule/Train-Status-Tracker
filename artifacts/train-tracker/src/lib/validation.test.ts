import { describe, expect, it } from "vitest";
import {
  TRAINS,
  formatDuration,
  formatShortDate,
  getUpcomingDates,
  isValidDepartureDate,
  matchesTrainNumber,
  normalizeTrainNumber,
  toApiDate,
} from "@workspace/trains-data";
import {
  isValidTrainNumberFormat,
  resolveTrain,
  splitHighlight,
  validateTrainQuery,
} from "./validation";
import type { TrainEntry } from "@workspace/trains-data";

const suggestion = (number: string, name = `Train ${number}`): TrainEntry => ({
  number,
  name,
});

describe("normalizeTrainNumber", () => {
  it("trims whitespace and uppercases", () => {
    expect(normalizeTrainNumber("  22943  ")).toBe("22943");
    expect(normalizeTrainNumber("raj")).toBe("RAJ");
  });

  it("removes internal spaces", () => {
    expect(normalizeTrainNumber("2 2 9 4 3")).toBe("22943");
  });
});

describe("isValidTrainNumberFormat", () => {
  it("accepts exactly five digits", () => {
    expect(isValidTrainNumberFormat("22943")).toBe(true);
  });

  it("rejects non-digits, short and long values", () => {
    expect(isValidTrainNumberFormat("2294")).toBe(false);
    expect(isValidTrainNumberFormat("229432")).toBe(false);
    expect(isValidTrainNumberFormat("abcde")).toBe(false);
    expect(isValidTrainNumberFormat("")).toBe(false);
  });
});

describe("matchesTrainNumber", () => {
  it("compares normalized values", () => {
    expect(matchesTrainNumber("22943", "22943")).toBe(true);
    expect(matchesTrainNumber(" 22943 ", "22943")).toBe(true);
    expect(matchesTrainNumber("22944", "22943")).toBe(false);
  });
});

describe("getUpcomingDates", () => {
  it("returns today onward for the given count", () => {
    const now = new Date(2026, 7, 2); // 2026-08-02 local
    expect(getUpcomingDates(3, now)).toEqual([
      "2026-08-02",
      "2026-08-03",
      "2026-08-04",
    ]);
  });

  it("rolls over month and year boundaries", () => {
    const now = new Date(2026, 11, 30);
    expect(getUpcomingDates(3, now)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
    ]);
  });

  it("returns empty for count <= 0", () => {
    expect(getUpcomingDates(0)).toEqual([]);
    expect(getUpcomingDates(-1)).toEqual([]);
  });
});

describe("formatShortDate", () => {
  it("renders day + short month", () => {
    expect(formatShortDate("2026-08-02")).toBe("2 Aug");
  });

  it("pads nothing and handles single-digit days", () => {
    expect(formatShortDate("2026-12-01")).toBe("1 Dec");
  });

  it("returns the input unchanged when not a valid ISO date", () => {
    expect(formatShortDate("nonsense")).toBe("nonsense");
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(510)).toBe("8h 30m");
    expect(formatDuration(480)).toBe("8h");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("handles invalid input fail-closed", () => {
    expect(formatDuration(NaN)).toBe("--");
    expect(formatDuration(-5)).toBe("--");
    expect(formatDuration(Infinity)).toBe("--");
  });
});

describe("isValidDepartureDate", () => {
  const now = new Date(2026, 7, 2); // 2026-08-02 local

  it("accepts today", () => {
    expect(isValidDepartureDate("2026-08-02", now)).toBe(true);
  });

  it("accepts a future date", () => {
    expect(isValidDepartureDate("2026-08-15", now)).toBe(true);
  });

  it("rejects past dates", () => {
    expect(isValidDepartureDate("2026-08-01", now)).toBe(false);
    expect(isValidDepartureDate("2020-01-01", now)).toBe(false);
  });

  it("rejects malformed and impossible calendar dates", () => {
    expect(isValidDepartureDate("20260802", now)).toBe(false);
    expect(isValidDepartureDate("2026-13-01", now)).toBe(false);
    expect(isValidDepartureDate("2026-02-30", now)).toBe(false);
    expect(isValidDepartureDate("", now)).toBe(false);
  });
});

describe("toApiDate", () => {
  it("converts YYYY-MM-DD to YYYYMMDD", () => {
    expect(toApiDate("2026-08-02")).toBe("20260802");
  });
});

describe("validateTrainQuery", () => {
  it("is idle for empty input", () => {
    expect(validateTrainQuery("", null, TRAINS)).toEqual({ status: "idle" });
  });

  it("is idle for input shorter than two characters", () => {
    expect(validateTrainQuery("2", null, TRAINS)).toEqual({ status: "idle" });
    expect(validateTrainQuery("R", null, TRAINS)).toEqual({ status: "idle" });
  });

  it("is valid for an exact number match", () => {
    expect(validateTrainQuery("22943", null, TRAINS)).toMatchObject({
      status: "valid",
      message: "hint.valid",
    });
  });

  it("is valid for a unique full-name match", () => {
    expect(validateTrainQuery("SEALDAH RAJDHANI EXPRESS", null, TRAINS)).toMatchObject({
      status: "valid",
      message: "hint.valid",
    });
  });

  it("is valid for a unique full name with arbitrary spacing", () => {
    expect(validateTrainQuery("sealdah   rajdhani express", null, TRAINS)).toMatchObject({
      status: "valid",
    });
  });

  it("is valid when a previously selected suggestion matches the input", () => {
    const selected = suggestion("22943", "Indore Intercity SF Express");
    expect(validateTrainQuery("22943", selected, TRAINS)).toMatchObject({
      status: "valid",
      message: "hint.valid",
    });
  });

  it("ignores a stale selection that no longer matches the input", () => {
    const selected = suggestion("12001");
    expect(validateTrainQuery("22943", selected, TRAINS)).toMatchObject({
      status: "valid",
    });
  });

  it("dedupes duplicate numbers before resolving", () => {
    expect(validateTrainQuery("12311", null, TRAINS)).toMatchObject({
      status: "valid",
    });
  });

  it("is invalid with partial results (pickSuggestion)", () => {
    expect(validateTrainQuery("229", null, TRAINS)).toMatchObject({
      status: "invalid",
      message: "hint.pickSuggestion",
    });
    expect(validateTrainQuery("RAJ", null, TRAINS)).toMatchObject({
      status: "invalid",
      message: "hint.pickSuggestion",
    });
  });

  it("prefers pickSuggestion over invalidFormat when results exist", () => {
    expect(validateTrainQuery("2294", null, TRAINS)).toMatchObject({
      status: "invalid",
      message: "hint.pickSuggestion",
    });
  });

  it("is invalid (invalidFormat) for a short numeric input with no matches", () => {
    expect(validateTrainQuery("77", null, TRAINS)).toMatchObject({
      status: "invalid",
      message: "hint.invalidFormat",
    });
  });

  it("is invalid (noMatch) for gibberish", () => {
    expect(validateTrainQuery("ZZZZ", null, TRAINS)).toMatchObject({
      status: "invalid",
      message: "hint.noMatch",
    });
  });

  it("is invalid (noMatch) for a well-formed number not in the dataset", () => {
    expect(validateTrainQuery("99999", null, TRAINS)).toMatchObject({
      status: "invalid",
      message: "hint.noMatch",
    });
  });

  it("is invalid (pickSuggestion) for an ambiguous shared name", () => {
    expect(validateTrainQuery("GOLDEN TEMPLE MAIL", null, TRAINS)).toMatchObject({
      status: "invalid",
      message: "hint.pickSuggestion",
    });
  });
});

describe("resolveTrain", () => {
  it("resolves via the selected train", () => {
    const selected = suggestion("22943", "Indore Intercity SF Express");
    expect(resolveTrain("22943", selected, TRAINS)).toEqual(selected);
  });

  it("resolves via exact number (normalized, spaces stripped)", () => {
    expect(resolveTrain(" 2 2 9 4 3 ", null, TRAINS)).toEqual({
      number: "22943",
      name: "Indore Intercity SF Express",
    });
  });

  it("resolves via unique full name (case/space insensitive)", () => {
    expect(resolveTrain("indore   intercity  sf express", null, TRAINS)).toEqual({
      number: "22943",
      name: "Indore Intercity SF Express",
    });
  });

  it("returns null for an ambiguous shared name", () => {
    expect(resolveTrain("GOLDEN TEMPLE MAIL", null, TRAINS)).toBeNull();
  });

  it("returns null for an unknown query", () => {
    expect(resolveTrain("ZZZZ", null, TRAINS)).toBeNull();
    expect(resolveTrain("99999", null, TRAINS)).toBeNull();
  });

  it("returns null for an empty query", () => {
    expect(resolveTrain("", null, TRAINS)).toBeNull();
  });
});

describe("splitHighlight", () => {
  it("highlights the matching substring", () => {
    expect(splitHighlight("22943", "229")).toEqual([
      { text: "229", highlight: true },
      { text: "43", highlight: false },
    ]);
  });

  it("returns a single unhighlighted part when there is no match", () => {
    expect(splitHighlight("22943", "111")).toEqual([
      { text: "22943", highlight: false },
    ]);
  });

  it("returns a single unhighlighted part for an empty query", () => {
    expect(splitHighlight("22943", "")).toEqual([
      { text: "22943", highlight: false },
    ]);
  });

  it("handles a match in the middle", () => {
    expect(splitHighlight("12001", "200")).toEqual([
      { text: "1", highlight: false },
      { text: "200", highlight: true },
      { text: "1", highlight: false },
    ]);
  });

  it("matches a multi-word query across the spaces in the name", () => {
    expect(splitHighlight("Mumbai Rajdhani Express", "mumbai rajdhani")).toEqual([
      { text: "Mumbai Rajdhani", highlight: true },
      { text: " Express", highlight: false },
    ]);
  });

  it("matches a space-free query that spans name words", () => {
    expect(splitHighlight("Mumbai Rajdhani Express", "MUMBAIRAJDHANI")).toEqual([
      { text: "Mumbai Rajdhani", highlight: true },
      { text: " Express", highlight: false },
    ]);
  });
});

import { describe, expect, it } from "vitest";
import {
  isValidDepartureDate,
  isValidTrainNumberFormat,
  matchesTrainNumber,
  normalizeTrainNumber,
  splitHighlight,
  toApiDate,
  validateTrain,
} from "./validation";
import type { TrainSuggestion } from "@workspace/api-client-react";

const suggestion = (number: string, name = `Train ${number}`): TrainSuggestion => ({
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

describe("validateTrain", () => {
  it("is idle for empty input", () => {
    expect(validateTrain("", null, [], "idle")).toEqual({ status: "idle" });
  });

  it("is invalid when the format is wrong", () => {
    expect(validateTrain("22", null, [], "success")).toMatchObject({
      status: "invalid",
    });
  });

  it("is checking while a fetch is in flight", () => {
    expect(validateTrain("22943", null, [], "fetching")).toMatchObject({
      status: "checking",
    });
  });

  it("is valid when exactly one suggestion matches", () => {
    const results = [suggestion("22943")];
    expect(validateTrain("22943", null, results, "success")).toMatchObject({
      status: "valid",
    });
  });

  it("is valid when a previously selected suggestion still matches", () => {
    const selected = suggestion("22943");
    expect(validateTrain("22943", selected, [], "success")).toMatchObject({
      status: "valid",
    });
  });

  it("ignores a stale selection that no longer matches the input", () => {
    const selected = suggestion("12001");
    expect(validateTrain("22943", selected, [], "success")).toMatchObject({
      status: "invalid",
    });
  });

  it("is invalid when nothing matches", () => {
    expect(validateTrain("99999", null, [suggestion("22943")], "success")).toMatchObject({
      status: "invalid",
    });
  });

  it("is invalid when two suggestions match (ambiguous)", () => {
    const results = [suggestion("22943"), suggestion("22943")];
    expect(validateTrain("22943", null, results, "success")).toMatchObject({
      status: "invalid",
    });
  });

  it("is invalid on fetch error (fail closed)", () => {
    expect(validateTrain("22943", null, [], "error")).toMatchObject({
      status: "invalid",
    });
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
});

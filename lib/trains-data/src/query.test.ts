import { describe, expect, it } from "vitest";
import type { TrainEntry } from "./search";
import {
  findTrainByNumber,
  matchesTrainName,
  matchesTrainNumber,
  MIN_QUERY_LENGTH,
  normalizeTrainNumber,
  uniqueByNumber,
} from "./query";

const sample: TrainEntry[] = [
  { number: "22943", name: "Indore Intercity SF Express" },
  { number: "22943", name: "Duplicate Intercity" },
  { number: "12001", name: "Bhopal Shatabdi Express" },
];

describe("normalizeTrainNumber", () => {
  it("strips whitespace and uppercases", () => {
    expect(normalizeTrainNumber(" 22943 ")).toBe("22943");
    expect(normalizeTrainNumber("raJ ")).toBe("RAJ");
  });
});

describe("matchesTrainNumber", () => {
  it("compares normalized values", () => {
    expect(matchesTrainNumber("22943", "22943")).toBe(true);
    expect(matchesTrainNumber("22943", "22944")).toBe(false);
  });
});

describe("matchesTrainName", () => {
  it("is case/space-insensitive exact match", () => {
    expect(matchesTrainName("Indore Intercity SF Express", "INDORE INTERCITY SF EXPRESS")).toBe(true);
    expect(matchesTrainName("Indore Intercity SF Express", "IndoreExpress")).toBe(false);
  });
});

describe("uniqueByNumber", () => {
  it("keeps first occurrence per number", () => {
    const unique = uniqueByNumber(sample);
    expect(unique).toHaveLength(2);
    expect(unique[0].name).toBe("Indore Intercity SF Express");
  });
});

describe("findTrainByNumber", () => {
  it("finds by exact number, first entry wins", () => {
    expect(findTrainByNumber(sample, "22943")?.name).toBe("Indore Intercity SF Express");
  });

  it("returns null when not found", () => {
    expect(findTrainByNumber(sample, "99999")).toBeNull();
  });
});

it("MIN_QUERY_LENGTH is 2", () => {
  expect(MIN_QUERY_LENGTH).toBe(2);
});

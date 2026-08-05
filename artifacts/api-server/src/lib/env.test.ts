import { describe, expect, it } from "vitest";
import { envPositiveNumber } from "./env";

const EMPTY: Record<string, string | undefined> = {};

describe("envPositiveNumber", () => {
  it("returns the fallback when the variable is unset", () => {
    expect(envPositiveNumber(EMPTY, "TTL", 42)).toBe(42);
  });

  it("parses a valid positive value", () => {
    expect(envPositiveNumber({ TTL: "5000" }, "TTL", 42)).toBe(5000);
  });

  it("ignores surrounding whitespace", () => {
    expect(envPositiveNumber({ TTL: "  5000  " }, "TTL", 42)).toBe(5000);
  });

  it.each(["0", "-1", "abc", "NaN", "Infinity", "-Infinity", ""])(
    "falls back for invalid value %j",
    (value) => {
      expect(envPositiveNumber({ TTL: value }, "TTL", 42)).toBe(42);
    },
  );
});

import { describe, expect, it } from "vitest";
import { searchTrains, TRAINS } from "./trains-data";

describe("searchTrains", () => {
  it("matches by exact number", () => {
    const results = searchTrains("22943");
    expect(results).toContainEqual({ number: "22943", name: "Indore Intercity SF Express" });
  });

  it("matches by number prefix", () => {
    const results = searchTrains("120");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((t) => t.number.startsWith("120"))).toBe(true);
  });

  it("matches by name fragment case-insensitively", () => {
    const results = searchTrains("rajdhani");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((t) => t.name.toLowerCase().includes("rajdhani"))).toBe(true);
  });

  it("returns no duplicates for the same number", () => {
    const results = searchTrains("123");
    const numbers = results.map((t) => t.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("limits results to 10 by default", () => {
    const results = searchTrains("1");
    expect(results.length).toBeLessThanOrEqual(10);
  });

  it("honours a custom limit", () => {
    const results = searchTrains("1", 3);
    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("returns nothing for queries shorter than 2 chars", () => {
    expect(searchTrains("2")).toEqual([]);
    expect(searchTrains("")).toEqual([]);
    expect(searchTrains("   ")).toEqual([]);
  });

  it("returns nothing for unknown queries", () => {
    expect(searchTrains("999999")).toEqual([]);
  });

  it("dataset numbers are all 5 digits", () => {
    for (const t of TRAINS) {
      expect(t.number).toMatch(/^\d{5}$/);
    }
  });
});

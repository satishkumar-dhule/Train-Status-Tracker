import { describe, expect, it } from "vitest";
import { searchTrains, TRAINS } from "./search";
import type { TrainEntry } from "./search";

describe("searchTrains", () => {
  it("matches by exact number", () => {
    const results = searchTrains("22943");
    expect(results).toContainEqual({
      number: "22943",
      name: "Indore Intercity SF Express",
    });
  });

  it("matches by number prefix", () => {
    const results = searchTrains("120");
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((t) => t.number.startsWith("120"))).toBe(true);
  });

  it("matches by name fragment case-insensitively", () => {
    const results = searchTrains("rajdhani");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((t) => t.name.toLowerCase().includes("rajdhani"))).toBe(
      true,
    );
  });

  it("matches multi-word names despite spaces in the query", () => {
    const results = searchTrains("mumbai rajdhani");
    expect(results).toContainEqual({
      number: "12951",
      name: "Mumbai Rajdhani Express",
    });
  });

  it("matches multi-word names when spaces are stripped from the query", () => {
    const results = searchTrains("MUMBAIRAJDHANI");
    expect(results).toContainEqual({
      number: "12951",
      name: "Mumbai Rajdhani Express",
    });
  });

  it("matches when the query is a space-free fragment spanning words", () => {
    const results = searchTrains("indore intercity");
    expect(results).toContainEqual({
      number: "22943",
      name: "Indore Intercity SF Express",
    });
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

  it("dataset numbers are unique", () => {
    const numbers = TRAINS.map((t) => t.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("dataset entries have non-empty names", () => {
    for (const t of TRAINS) {
      expect(t.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("known corrected entries resolve to the right names", () => {
    expect(TRAINS.find((t) => t.number === "12311")?.name).toBe(
      "Netaji Express",
    );
    expect(TRAINS.find((t) => t.number === "20901")?.name).toBe(
      "Mumbai Central Vande Bharat Express",
    );
  });
});

describe("searchTrains duck-typed matching", () => {
  it("ranks number-prefix matches above number-contains matches", () => {
    const results = searchTrains("2294");
    expect(results[0].number.startsWith("2294")).toBe(true);
  });

  it("surfaces trains whose word starts with the query", () => {
    const results = searchTrains("shatabdi");
    expect(results.some((t) => t.name.includes("Shatabdi"))).toBe(true);
  });

  it("matches fuzzy subsequences for the name", () => {
    // "rjdn" is a subsequence of "RAJDHANI" but not a substring.
    const results = searchTrains("rjdn");
    expect(results.some((t) => t.name.toLowerCase().includes("rajdhani"))).toBe(
      true,
    );
  });

  it("surfaces typos as subsequence matches", () => {
    // "rajhani" is a subsequence (not substring) of "HOWRAHRAJDHANIEXPRESS".
    const results = searchTrains("rajhani");
    expect(results.some((t) => t.name.toLowerCase().includes("rajdhani"))).toBe(
      true,
    );
  });

  it("accepts an explicit dataset instead of the bundled list", () => {
    const custom: TrainEntry[] = [
      { number: "99901", name: "Custom Rocket" },
      { number: "12001", name: "Bhopal Shatabdi Express" },
    ];
    const results = searchTrains("rocket", 10, custom);
    expect(results).toEqual([{ number: "99901", name: "Custom Rocket" }]);
  });

  it("dedupes a dataset with repeated numbers", () => {
    const custom: TrainEntry[] = [
      { number: "12001", name: "Bhopal Shatabdi Express" },
      { number: "12001", name: "Dup" },
      { number: "12002", name: "New Delhi Shatabdi Express" },
    ];
    const results = searchTrains("shatabdi", 10, custom);
    expect(results.map((t) => t.number)).toEqual(["12001", "12002"]);
  });

  it("does not match numbers for non-numeric queries", () => {
    expect(
      searchTrains("mumbai", 10, TRAINS).every((t) => !/^\d+$/.test(t.name)),
    ).toBe(true);
  });

  it("fully numeric queries only match train numbers", () => {
    const results = searchTrains("12951");
    expect(results).toContainEqual({
      number: "12951",
      name: "Mumbai Rajdhani Express",
    });
    expect(results.every((t) => t.number.startsWith("12951"))).toBe(true);
  });
});

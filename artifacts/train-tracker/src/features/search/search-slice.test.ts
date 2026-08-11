import { describe, expect, it } from "vitest";
import { TRAINS } from "@workspace/trains-data";
import type { TrainEntry } from "@workspace/trains-data";
import { buildSuggestions, submitSearch, validationPhase } from "./search-slice";
import type { ValidationTiming } from "./search-slice";

function timing(
  value: string,
  lastValidatedOnBlur: boolean,
  phase: ValidationTiming["phase"] = "idle",
): ValidationTiming {
  return { value, lastValidatedOnBlur, phase };
}

describe("buildSuggestions", () => {
  const recents = [
    "12301",
    "12302",
    "12305",
    "12306",
    "12309",
    "12310",
    "12313",
    "12314",
  ];

  it("shows recents only when the value is empty, capped at five, most-recent-first", () => {
    const items = buildSuggestions("", TRAINS, recents);
    expect(items).toHaveLength(5);
    expect(items.map((item) => item.trainNumber)).toEqual([
      "12301",
      "12302",
      "12305",
      "12306",
      "12309",
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "recent-12301",
      "recent-12302",
      "recent-12305",
      "recent-12306",
      "recent-12309",
    ]);
    for (const item of items) {
      expect(item.type).toBe("recent");
      expect(item.highlight).toEqual({ number: [], name: [] });
    }
  });

  it("resolves recent names from the catalog", () => {
    const items = buildSuggestions("", TRAINS, ["12301"]);
    expect(items[0]).toMatchObject({
      trainNumber: "12301",
      trainName: "Howrah Rajdhani Express",
    });
  });

  it("shows recents only for a value shorter than the query minimum", () => {
    expect(buildSuggestions("1", TRAINS, ["12301"])[0].type).toBe("recent");
    expect(buildSuggestions(" ", TRAINS, ["12301"])[0].type).toBe("recent");
  });

  it("skips recents that are not in the catalog", () => {
    expect(
      buildSuggestions("", TRAINS, ["12301", "99999", "12302"]).map(
        (item) => item.trainNumber,
      ),
    ).toEqual(["12301", "12302"]);
  });

  it("returns an empty list for short input with no recents", () => {
    expect(buildSuggestions("1", TRAINS, [])).toEqual([]);
  });

  it("ranks catalog matches and caps at six", () => {
    const items = buildSuggestions("12", TRAINS, []);
    expect(items.map((item) => item.trainNumber)).toEqual([
      "12001",
      "12002",
      "12003",
      "12004",
      "12005",
      "12006",
    ]);
    expect(items).toHaveLength(6);
    expect(items.every((item) => item.type === "catalog")).toBe(true);
    expect(items.map((item) => item.id)).toEqual([
      "suggest-12001",
      "suggest-12002",
      "suggest-12003",
      "suggest-12004",
      "suggest-12005",
      "suggest-12006",
    ]);
  });

  it("excludes recents once the query is long enough", () => {
    const items = buildSuggestions("12", TRAINS, ["12301", "12001"]);
    expect(items.some((item) => item.type === "recent")).toBe(false);
    expect(items.some((item) => item.id === "recent-12001")).toBe(false);
    expect(items.some((item) => item.id === "suggest-12001")).toBe(true);
  });

  it("computes number highlight pairs on catalog matches", () => {
    const items = buildSuggestions("229", TRAINS, []);
    expect(items[0]).toMatchObject({
      trainNumber: "22943",
      trainName: "Indore Intercity SF Express",
      highlight: { number: [0, 3], name: [] },
    });
    const exact = buildSuggestions("22943", TRAINS, []);
    expect(exact[0].highlight).toEqual({ number: [0, 5], name: [] });
  });

  it("computes name highlight pairs on catalog matches", () => {
    const items = buildSuggestions("rajasthan", TRAINS, []);
    expect(items[0]).toMatchObject({
      trainNumber: "12400",
      trainName: "Rajasthan Express",
      highlight: { number: [], name: [0, 9] },
    });
  });

  it("returns an empty list when nothing matches and there are no recents", () => {
    expect(buildSuggestions("zzzz", TRAINS, [])).toEqual([]);
    expect(buildSuggestions("", TRAINS, [])).toEqual([]);
  });
});

describe("validationPhase", () => {
  it("is idle for empty and too-short values regardless of blur state", () => {
    expect(validationPhase(timing("", false))).toBe("idle");
    expect(validationPhase(timing("", true))).toBe("idle");
    expect(validationPhase(timing("1", false))).toBe("idle");
    expect(validationPhase(timing("1", true))).toBe("idle");
  });

  it("is typing while editing, never flagging mid-typing", () => {
    expect(validationPhase(timing("22943", false))).toBe("typing");
    expect(validationPhase(timing("2294", false))).toBe("typing");
    expect(validationPhase(timing("99999", false))).toBe("typing");
    expect(validationPhase(timing("abcde", false))).toBe("typing");
  });

  it("is valid after blur for a well-formed number with a match", () => {
    expect(validationPhase(timing("22943", true))).toBe("valid");
    expect(validationPhase(timing(" 22943 ", true))).toBe("valid");
  });

  it("is invalid after blur for bad format or no match", () => {
    expect(validationPhase(timing("2294", true))).toBe("invalid");
    expect(validationPhase(timing("abcde", true))).toBe("invalid");
    expect(validationPhase(timing("12", true))).toBe("invalid");
    expect(validationPhase(timing("99999", true))).toBe("invalid");
  });

  it("re-validates live as the caller edits after an invalid blur", () => {
    const afterBlur = timing("2294", true, "invalid");
    expect(validationPhase(afterBlur)).toBe("invalid");
    const editing = { ...afterBlur, value: "22943", lastValidatedOnBlur: false };
    expect(validationPhase(editing)).toBe("typing");
    const afterEditBlur = { ...editing, lastValidatedOnBlur: true };
    expect(validationPhase(afterEditBlur)).toBe("valid");
  });

  it("returns to typing when a valid value is edited, dropping stale validity", () => {
    const afterBlur = timing("22943", true, "valid");
    expect(validationPhase({ ...afterBlur, value: "2294", lastValidatedOnBlur: false })).toBe(
      "typing",
    );
  });

  it("honors custom format and match checks", () => {
    expect(
      validationPhase(timing("12345", true), {
        isValidFormat: () => true,
        hasMatch: () => false,
      }),
    ).toBe("invalid");
    expect(
      validationPhase(timing("12345", true), {
        isValidFormat: () => true,
        hasMatch: () => true,
      }),
    ).toBe("valid");
    expect(
      validationPhase(timing("12345", true), {
        isValidFormat: () => false,
        hasMatch: () => true,
      }),
    ).toBe("invalid");
  });

  it("honors a custom minQueryLength", () => {
    expect(validationPhase(timing("2294", true), { minQueryLength: 5 })).toBe("idle");
    expect(validationPhase(timing("22943", true), { minQueryLength: 5 })).toBe("valid");
  });

  it("honors a custom trains catalog for the default match check", () => {
    const small: TrainEntry[] = [{ number: "11111", name: "Test Express" }];
    expect(validationPhase(timing("11111", true), { trains: small })).toBe("valid");
    expect(validationPhase(timing("22943", true), { trains: small })).toBe("invalid");
  });
});

describe("submitSearch", () => {
  it("returns ok for a well-formed number with a catalog match", () => {
    expect(submitSearch("22943", TRAINS)).toEqual({ ok: true });
  });

  it("normalizes spaces before checking", () => {
    expect(submitSearch(" 22943 ", TRAINS)).toEqual({ ok: true });
    expect(submitSearch("2 2 9 4 3", TRAINS)).toEqual({ ok: true });
  });

  it("returns format for a malformed number", () => {
    expect(submitSearch("2294", TRAINS)).toEqual({ ok: false, reason: "format" });
    expect(submitSearch("abcde", TRAINS)).toEqual({ ok: false, reason: "format" });
    expect(submitSearch("", TRAINS)).toEqual({ ok: false, reason: "format" });
    expect(submitSearch("Rajasthan Express", TRAINS)).toEqual({
      ok: false,
      reason: "format",
    });
  });

  it("returns not-found for a well-formed number without a match", () => {
    expect(submitSearch("99999", TRAINS)).toEqual({ ok: false, reason: "not-found" });
  });

  it("honors a custom normalize function", () => {
    expect(submitSearch(" 22943 ", TRAINS, { normalize: (v) => v })).toEqual({
      ok: false,
      reason: "format",
    });
  });
});

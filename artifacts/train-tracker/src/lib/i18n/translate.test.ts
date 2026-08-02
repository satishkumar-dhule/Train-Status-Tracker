import { describe, expect, it } from "vitest";
import { DICTIONARY } from "./dictionary";
import { translate } from "./translate";
import { KEYS, LANGS } from "./types";

describe("translate", () => {
  it("returns the exact string for English keys", () => {
    expect(translate(DICTIONARY, "en", "action.executeTrace")).toBe(
      "Execute Trace",
    );
  });

  it("returns the translated string for non-English keys", () => {
    expect(translate(DICTIONARY, "hi", "action.executeTrace")).toBe(
      "ट्रेस चलाएँ",
    );
  });

  it("interpolates numeric params", () => {
    expect(translate(DICTIONARY, "en", "status.lateMinutes", { n: 42 })).toBe(
      "42M LATE",
    );
  });

  it("interpolates string params", () => {
    expect(translate(DICTIONARY, "en", "status.updated", { time: "14:05" })).toBe(
      "Updated: 14:05",
    );
  });

  it("leaves unknown params untouched", () => {
    expect(translate(DICTIONARY, "en", "status.lateMinutes", { x: 1 })).toBe(
      "{n}M LATE",
    );
  });

  it("returns English for languages with partial translations (fallback merge)", () => {
    expect(translate(DICTIONARY, "gu", "app.title")).toBe("Terminal.Track");
  });

  it("never produces an undefined template for any lang/key", () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        const out = translate(DICTIONARY, lang, key, { n: 1, time: "x" });
        expect(out).toBeTypeOf("string");
        expect(out.length).toBeGreaterThan(0);
      }
    }
  });
});

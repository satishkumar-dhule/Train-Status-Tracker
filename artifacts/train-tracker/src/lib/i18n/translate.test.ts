import { describe, expect, it } from "vitest";
import { DICTIONARY } from "./dictionary";
import { translate } from "./translate";
import { KEYS, LANGS } from "./types";

describe("translate", () => {
  it("returns the exact string for English keys", () => {
    expect(translate(DICTIONARY, "en", "action.search")).toBe("Search");
  });

  it("returns the translated string for non-English keys", () => {
    expect(translate(DICTIONARY, "hi", "action.search")).toBe("खोजें");
  });

  it("interpolates numeric params", () => {
    expect(translate(DICTIONARY, "en", "status.lateMinutes", { n: 42 })).toBe(
      "+42 min",
    );
  });

  it("interpolates string params", () => {
    expect(translate(DICTIONARY, "en", "status.updated", { time: "14:05" })).toBe(
      "Updated: 14:05",
    );
  });

  it("leaves unknown params untouched", () => {
    expect(translate(DICTIONARY, "en", "status.lateMinutes", { x: 1 })).toBe(
      "+{n} min",
    );
  });

  it("returns the translated string for languages with complete dictionaries", () => {
    expect(translate(DICTIONARY, "gu", "app.title")).toBe("રેલ સારથી");
    expect(translate(DICTIONARY, "mr", "status.onTime")).toBe("वेळेवर");
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

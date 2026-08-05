import { describe, expect, it } from "vitest";
import { DICTIONARY, core } from "./dictionary";
import { KEYS, LANGS } from "./types";

const partialLangs = Object.keys(core) as Array<keyof typeof core>;

describe("dictionary", () => {
  it("keeps the en dictionary keys in sync with KEYS", () => {
    expect(new Set(Object.keys(DICTIONARY.en))).toEqual(new Set(KEYS));
  });

  it("defines every key in every language dictionary", () => {
    for (const lang of LANGS) {
      for (const key of KEYS) {
        expect(DICTIONARY[lang]).toHaveProperty(key);
      }
    }
  });

  it("does not fall back to English in the partial dictionaries", () => {
    for (const lang of partialLangs) {
      expect(Object.keys(core[lang]).length).toBe(KEYS.length);
      for (const key of KEYS) {
        expect(core[lang]).toHaveProperty(key);
      }
    }
  });
});

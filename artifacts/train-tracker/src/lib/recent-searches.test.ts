import { describe, expect, it } from "vitest";
import type { TrainEntry } from "@workspace/trains-data";
import {
  DEFAULT_RECENT_LIMIT,
  RECENT_SEARCHES_STORAGE_KEY,
  loadRecentSearches,
  saveRecentSearch,
} from "./recent-searches";
import type { RecentStorage } from "./recent-searches";

const suggestion = (number: string, name = `Train ${number}`): TrainEntry => ({
  number,
  name,
});

function createStorage(): RecentStorage & { raw: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    raw: map,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

const throwingStorage: RecentStorage = {
  getItem: () => {
    throw new Error("storage denied");
  },
  setItem: () => {
    throw new Error("storage denied");
  },
};

describe("loadRecentSearches", () => {
  it("returns [] for empty storage", () => {
    expect(loadRecentSearches(createStorage())).toEqual([]);
  });

  it("returns [] for corrupt JSON", () => {
    const storage = createStorage();
    storage.raw.set(RECENT_SEARCHES_STORAGE_KEY, "{not json");
    expect(loadRecentSearches(storage)).toEqual([]);
  });

  it("returns [] for non-array JSON", () => {
    for (const value of ["42", '"str"', "null", "{}"]) {
      const storage = createStorage();
      storage.raw.set(RECENT_SEARCHES_STORAGE_KEY, value);
      expect(loadRecentSearches(storage)).toEqual([]);
    }
  });

  it("drops malformed entries and keeps valid ones", () => {
    const storage = createStorage();
    storage.raw.set(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify([
        suggestion("22943"),
        { number: "12001" },
        { name: "Missing Number" },
        { number: 5, name: "Not A String" },
        null,
        "string",
        suggestion("12345", "Valid Two"),
      ]),
    );
    expect(loadRecentSearches(storage)).toEqual([
      suggestion("22943"),
      suggestion("12345", "Valid Two"),
    ]);
  });

  it("caps the result at the limit", () => {
    const storage = createStorage();
    const entries = ["1", "2", "3", "4", "5", "6", "7", "8"].map((n) =>
      suggestion(n),
    );
    storage.raw.set(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(entries));
    expect(loadRecentSearches(storage, 3)).toEqual(entries.slice(0, 3));
    expect(loadRecentSearches(storage)).toHaveLength(DEFAULT_RECENT_LIMIT);
  });

  it("returns [] when storage throws", () => {
    expect(loadRecentSearches(throwingStorage)).toEqual([]);
  });
});

describe("saveRecentSearch", () => {
  it("roundtrips through storage, most recent first", () => {
    const storage = createStorage();
    saveRecentSearch(storage, suggestion("1"));
    saveRecentSearch(storage, suggestion("2"));
    saveRecentSearch(storage, suggestion("3"));
    expect(loadRecentSearches(storage)).toEqual([
      suggestion("3"),
      suggestion("2"),
      suggestion("1"),
    ]);
  });

  it("moves an existing number to the front without duplicating", () => {
    const storage = createStorage();
    saveRecentSearch(storage, suggestion("1"));
    saveRecentSearch(storage, suggestion("2"));
    saveRecentSearch(storage, suggestion("3"));
    const result = saveRecentSearch(storage, suggestion("1", "Renamed One"));
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.number)).toEqual(["1", "3", "2"]);
    expect(loadRecentSearches(storage).map((t) => t.number)).toEqual([
      "1",
      "3",
      "2",
    ]);
  });

  it("enforces the limit when saving", () => {
    const storage = createStorage();
    for (let i = 1; i <= 10; i++) {
      saveRecentSearch(storage, suggestion(String(i)));
    }
    expect(loadRecentSearches(storage)).toHaveLength(DEFAULT_RECENT_LIMIT);
    expect(loadRecentSearches(storage)[0]).toEqual(suggestion("10"));
  });

  it("respects a custom limit", () => {
    const storage = createStorage();
    for (let i = 1; i <= 4; i++) {
      saveRecentSearch(storage, suggestion(String(i)), 3);
    }
    expect(loadRecentSearches(storage, 3)).toEqual([
      suggestion("4"),
      suggestion("3"),
      suggestion("2"),
    ]);
  });

  it("returns the new list without throwing when storage throws", () => {
    const result = saveRecentSearch(throwingStorage, suggestion("1"));
    expect(result).toEqual([suggestion("1")]);
  });

  it("dedupes against already-stored entries loaded from storage", () => {
    const storage = createStorage();
    storage.raw.set(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify([suggestion("2"), suggestion("1")]),
    );
    const result = saveRecentSearch(storage, suggestion("2"));
    expect(result.map((t) => t.number)).toEqual(["2", "1"]);
  });
});

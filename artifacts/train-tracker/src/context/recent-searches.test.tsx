import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createElement } from "react";
import type { ReactNode } from "react";
import type { TrainEntry } from "@workspace/trains-data";
import { RECENT_SEARCHES_STORAGE_KEY } from "../lib/recent-searches";
import {
  RecentSearchesProvider,
  useRecentSearches,
} from "./recent-searches";

const suggestion = (number: string, name = `Train ${number}`): TrainEntry => ({
  number,
  name,
});

function createFakeStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (key: string) => (raw.has(key) ? (raw.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      raw.set(key, value);
    },
  };
}

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(RecentSearchesProvider, null, children);

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useRecentSearches", () => {
  it("exposes recent + addRecent; addRecent prepends and dedupes", () => {
    const { result } = renderHook(() => useRecentSearches(), { wrapper });

    expect(result.current.recent).toEqual([]);
    expect(typeof result.current.addRecent).toBe("function");

    act(() => result.current.addRecent(suggestion("22943")));
    act(() => result.current.addRecent(suggestion("12901")));
    act(() => result.current.addRecent(suggestion("22943")));

    expect(result.current.recent).toEqual([
      suggestion("22943"),
      suggestion("12901"),
    ]);
  });

  it("persists to localStorage and a new provider loads stored data", () => {
    const storage = createFakeStorage();
    vi.stubGlobal("localStorage", storage);

    const first = renderHook(() => useRecentSearches(), { wrapper });
    act(() => first.result.current.addRecent(suggestion("22943")));
    act(() => first.result.current.addRecent(suggestion("12901")));

    const stored = JSON.parse(
      storage.getItem(RECENT_SEARCHES_STORAGE_KEY) ?? "[]",
    );
    expect(stored).toEqual([suggestion("12901"), suggestion("22943")]);

    first.unmount();

    const second = renderHook(() => useRecentSearches(), { wrapper });
    expect(second.result.current.recent).toEqual([
      suggestion("12901"),
      suggestion("22943"),
    ]);
    second.unmount();
  });

  it("throws when used outside a provider", () => {
    expect(() => renderHook(() => useRecentSearches())).toThrow(
      "useRecentSearches must be used within RecentSearchesProvider",
    );
  });

  it("shares state across multiple consumers in one provider", () => {
    const { result } = renderHook(
      () => ({
        first: useRecentSearches(),
        second: useRecentSearches(),
      }),
      { wrapper },
    );

    act(() => result.current.first.addRecent(suggestion("12001")));

    expect(result.current.first.recent).toEqual([suggestion("12001")]);
    expect(result.current.second.recent).toEqual([suggestion("12001")]);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  useViewPreference,
  VIEW_PREFERENCE_STORAGE_KEY,
} from "./use-view-preference";

describe("useViewPreference", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to the timeline view", () => {
    const { result } = renderHook(() => useViewPreference());
    expect(result.current[0]).toBe("timeline");
  });

  it("reads an existing stored preference", () => {
    localStorage.setItem(VIEW_PREFERENCE_STORAGE_KEY, "track");
    const { result } = renderHook(() => useViewPreference());
    expect(result.current[0]).toBe("track");
  });

  it("persists changes to localStorage", () => {
    const { result } = renderHook(() => useViewPreference());
    act(() => result.current[1]("track"));
    expect(result.current[0]).toBe("track");
    expect(localStorage.getItem(VIEW_PREFERENCE_STORAGE_KEY)).toBe("track");
  });

  it("falls back to the timeline view for unknown stored values", () => {
    localStorage.setItem(VIEW_PREFERENCE_STORAGE_KEY, "bogus");
    const { result } = renderHook(() => useViewPreference());
    expect(result.current[0]).toBe("timeline");
  });
});

// @vitest-environment jsdom

import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { AUTO_REFRESH_STORAGE_KEY, useAutoRefresh } from "./use-auto-refresh";

describe("useAutoRefresh", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to OFF and persists OFF on first mount", () => {
    const { result } = renderHook(() => useAutoRefresh());

    expect(result.current[0]).toBe(false);
    expect(window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY)).toBe("false");
  });

  it("reads a persisted ON preference from storage", () => {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, "true");

    const { result } = renderHook(() => useAutoRefresh());

    expect(result.current[0]).toBe(true);
  });

  it("treats anything other than the literal 'true' as OFF", () => {
    window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, "1");
    const { result } = renderHook(() => useAutoRefresh());
    expect(result.current[0]).toBe(false);
  });

  it("flipping the toggle updates state and persists it", () => {
    const { result } = renderHook(() => useAutoRefresh());

    act(() => {
      result.current[1](true);
    });

    expect(result.current[0]).toBe(true);
    expect(window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY)).toBe("true");
  });
});

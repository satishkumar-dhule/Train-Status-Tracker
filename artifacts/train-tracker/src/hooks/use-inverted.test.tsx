import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  INVERT_STORAGE_KEY,
  applyInverted,
  useInverted,
} from "./use-inverted";

describe("useInverted", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("inverted");
    localStorage.clear();
  });

  it("defaults to light (not inverted)", () => {
    const { result } = renderHook(() => useInverted());

    expect(result.current[0]).toBe(false);
  });

  it("applies the inverted class and persists when set to true", () => {
    const { result } = renderHook(() => useInverted());

    act(() => result.current[1](true));

    expect(result.current[0]).toBe(true);
    expect(document.documentElement).toHaveClass("inverted");
    expect(localStorage.getItem(INVERT_STORAGE_KEY)).toBe("true");
  });

  it("removes the class when set back to false", () => {
    const { result } = renderHook(() => useInverted());

    act(() => result.current[1](true));
    act(() => result.current[1](false));

    expect(result.current[0]).toBe(false);
    expect(document.documentElement).not.toHaveClass("inverted");
    expect(localStorage.getItem(INVERT_STORAGE_KEY)).toBe("false");
  });

  it("restores a stored inverted preference on mount", () => {
    localStorage.setItem(INVERT_STORAGE_KEY, "true");

    const { result } = renderHook(() => useInverted());

    expect(result.current[0]).toBe(true);
    expect(document.documentElement).toHaveClass("inverted");
  });

  it("applyInverted toggles the class without touching storage", () => {
    applyInverted(true);
    expect(document.documentElement).toHaveClass("inverted");

    applyInverted(false);
    expect(document.documentElement).not.toHaveClass("inverted");
  });
});

import "@testing-library/jest-dom/vitest";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { motion, useReducedMotion } from "./theme";

type MediaListener = (event: MediaQueryListEvent) => void;

function createMatchMediaStub(matches: boolean) {
  const listeners = new Set<MediaListener>();
  const addEventListener = vi.fn((_type: string, listener: MediaListener) => {
    listeners.add(listener);
  });
  const removeEventListener = vi.fn((_type: string, listener: MediaListener) => {
    listeners.delete(listener);
  });
  const mediaQueryList = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addEventListener,
    removeEventListener,
    dispatch: (nextMatches: boolean) => {
      for (const listener of listeners) {
        listener({ matches: nextMatches } as MediaQueryListEvent);
      }
    },
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQueryList));
  return mediaQueryList;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("motion", () => {
  it("exposes the canonical duration and easing values", () => {
    expect(motion).toEqual({
      fast: 150,
      base: 250,
      slow: 400,
      easing: "cubic-bezier(0.16,1,0.3,1)",
    });
  });

  it("freezes the values as literal types", () => {
    expect(motion.fast).toBe(150);
    expect(motion.base).toBe(250);
    expect(motion.slow).toBe(400);
    expect(motion.easing).toBe("cubic-bezier(0.16,1,0.3,1)");
  });
});

describe("useReducedMotion", () => {
  it("returns true when the user prefers reduced motion", () => {
    createMatchMediaStub(true);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(true);
  });

  it("returns false when reduced motion is not preferred", () => {
    createMatchMediaStub(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });

  it("updates when the media query change event fires", () => {
    const stub = createMatchMediaStub(false);
    const { result } = renderHook(() => useReducedMotion());

    expect(result.current).toBe(false);

    act(() => stub.dispatch(true));
    expect(result.current).toBe(true);

    act(() => stub.dispatch(false));
    expect(result.current).toBe(false);
  });

  it("subscribes to the media query on mount", () => {
    const stub = createMatchMediaStub(false);
    renderHook(() => useReducedMotion());

    expect(stub.addEventListener).toHaveBeenCalledTimes(1);
    expect(stub.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("removes its listener on unmount", () => {
    const stub = createMatchMediaStub(false);
    const { unmount } = renderHook(() => useReducedMotion());

    unmount();

    expect(stub.removeEventListener).toHaveBeenCalledTimes(1);
    expect(stub.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });

  it("falls back to false when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
  });
});

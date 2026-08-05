// @vitest-environment jsdom

import type React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TrainEntry } from "@workspace/trains-data";
import { useTrainAutocomplete } from "./use-train-autocomplete";

const RECENT: TrainEntry[] = [
  { number: "22943", name: "Indore Intercity SF Express" },
  { number: "12901", name: "Gujarat Mail" },
  { number: "12001", name: "Bhopal Shatabdi Express" },
];

const RECENT_RAW: TrainEntry[] = [
  { number: "229 43", name: "Indore Intercity SF Express" },
];

function makeKey(key: string, preventDefault = vi.fn()) {
  return { key, preventDefault } as unknown as React.KeyboardEvent;
}

function renderAutocomplete(
  initialValue = "",
  recent: TrainEntry[] = RECENT,
) {
  const onValueChange = vi.fn();
  const utils = renderHook(
    ({ value, recent: r }: { value: string; recent: TrainEntry[] }) =>
      useTrainAutocomplete(value, onValueChange, r),
    { initialProps: { value: initialValue, recent } },
  );
  return { ...utils, onValueChange };
}

describe("useTrainAutocomplete", () => {
  it("1. shows only recents (kind recent) for a short query", () => {
    const { result } = renderAutocomplete("2");
    expect(result.current.options.length).toBe(RECENT.length);
    expect(result.current.options.every((o) => o.kind === "recent")).toBe(true);
    expect(
      result.current.options.some((o) => o.kind === "suggestion"),
    ).toBe(false);
  });

  it("2. long query merges suggestions and dedupes matching recents", () => {
    const { result } = renderAutocomplete("229");
    const matching = result.current.options.filter(
      (o) => o.train.number === "22943",
    );
    expect(matching).toHaveLength(1);
    expect(matching[0].kind).toBe("recent");
    const recentIndex = result.current.options.indexOf(matching[0]);
    const firstSuggestionIndex = result.current.options.findIndex(
      (o) => o.kind === "suggestion",
    );
    expect(firstSuggestionIndex).toBeGreaterThan(-1);
    expect(recentIndex).toBeLessThan(firstSuggestionIndex);
  });

  it("3. open is false before focus and true after focus when options exist", () => {
    const { result } = renderAutocomplete("229");
    expect(result.current.open).toBe(false);
    act(() => result.current.handleFocus());
    expect(result.current.open).toBe(true);
  });

  it("4. ArrowDown -1->0; ArrowUp -1->last and ArrowUp wraps", () => {
    const { result } = renderAutocomplete("229");
    const last = result.current.options.length - 1;

    act(() => result.current.handleKeyDown(makeKey("ArrowDown")));
    expect(result.current.highlightedIndex).toBe(0);

    act(() => result.current.handleKeyDown(makeKey("ArrowUp")));
    expect(result.current.highlightedIndex).toBe(last);

    act(() => result.current.handleKeyDown(makeKey("ArrowUp")));
    expect(result.current.highlightedIndex).toBe(last - 1);
  });

  it("4b. ArrowUp from -1 goes to the last option (regression)", () => {
    const { result } = renderAutocomplete("229");
    const last = result.current.options.length - 1;
    act(() => result.current.handleKeyDown(makeKey("ArrowUp")));
    expect(result.current.highlightedIndex).toBe(last);
  });

  it("5. Enter with a highlighted option prevents default and selects it", () => {
    const { result, onValueChange } = renderAutocomplete("229");
    act(() => result.current.handleFocus());
    act(() => result.current.handleKeyDown(makeKey("ArrowDown")));
    const option = result.current.options[result.current.highlightedIndex];
    const preventDefault = vi.fn();

    act(() => result.current.handleKeyDown(makeKey("Enter", preventDefault)));

    expect(preventDefault).toHaveBeenCalled();
    expect(onValueChange).toHaveBeenCalledWith(
      expect.stringMatching(/^\d+$/),
    );
    expect(onValueChange).toHaveBeenCalledWith(option.train.number);
    expect(result.current.highlightedIndex).toBe(-1);
    expect(result.current.open).toBe(false);
  });

  it("6. Enter without a highlighted option does not prevent default", () => {
    const { result, onValueChange } = renderAutocomplete("229");
    act(() => result.current.handleFocus());
    expect(result.current.open).toBe(true);
    const preventDefault = vi.fn();

    act(() => result.current.handleKeyDown(makeKey("Enter", preventDefault)));

    expect(preventDefault).not.toHaveBeenCalled();
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("7. Escape closes; a subsequent focus reopens", () => {
    const { result } = renderAutocomplete("229");
    act(() => result.current.handleFocus());
    expect(result.current.open).toBe(true);

    act(() => result.current.handleKeyDown(makeKey("Escape")));
    expect(result.current.open).toBe(false);

    act(() => result.current.handleFocus());
    expect(result.current.open).toBe(true);
  });

  it("8. select normalizes the number and updates the value", () => {
    const { result, onValueChange } = renderAutocomplete("22943");
    const option = result.current.options.find((o) => o.kind === "recent")!;
    act(() => result.current.select(option));
    expect(onValueChange).toHaveBeenCalledWith("22943");
  });

  it("8b. select normalizes a raw spaced recents number", () => {
    const { result, onValueChange } = renderAutocomplete("22943", RECENT_RAW);
    const option = result.current.options.find((o) => o.kind === "recent")!;
    expect(option.train.number).toBe("229 43");
    act(() => result.current.select(option));
    expect(onValueChange).toHaveBeenCalledWith("22943");
  });

  it("9. activeOptionId tracks the highlighted option", () => {
    const { result } = renderAutocomplete("229");
    expect(result.current.activeOptionId).toBeNull();

    act(() => result.current.handleKeyDown(makeKey("ArrowDown")));
    expect(result.current.activeOptionId).toBe(
      result.current.options[0].id,
    );
  });

  it("10. status is valid with a fully-typed number and a selected train", () => {
    const { result } = renderAutocomplete("22943");
    expect(result.current.status.status).toBe("valid");

    act(() => result.current.select(result.current.options[0]));
    expect(result.current.status.status).toBe("valid");
  });

  it("11. scrolls the highlighted option into view", () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    try {
      const { result } = renderAutocomplete("229");
      const list = document.createElement("ul");
      const item = document.createElement("li");
      item.setAttribute("data-option-index", "0");
      list.appendChild(item);
      result.current.listRef.current = list;

      act(() => result.current.handleKeyDown(makeKey("ArrowDown")));

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
    } finally {
      if (original === undefined) {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)
          .scrollIntoView;
      } else {
        HTMLElement.prototype.scrollIntoView = original;
      }
    }
  });

  it("12. multi-word name queries surface the matching train (regression)", () => {
    const { result } = renderAutocomplete("mumbai rajdhani");
    const suggestion = result.current.options.find(
      (o) => o.train.number === "12951",
    );
    expect(suggestion).toBeDefined();
    expect(suggestion!.train.name).toBe("Mumbai Rajdhani Express");
  });
});

// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TrainEntry } from "@workspace/trains-data";
import { useTrainSearch } from "./use-train-search";

const TRAINS: TrainEntry[] = [
  { number: "22943", name: "Indore Intercity SF Express" },
  { number: "12951", name: "Mumbai Rajdhani Express" },
];

function renderSearch() {
  const addRecent = vi.fn();
  const utils = renderHook(() => useTrainSearch({ trains: TRAINS, addRecent }));
  return { ...utils, addRecent };
}

describe("useTrainSearch", () => {
  it("starts idle: nothing searched, empty params", () => {
    const { result } = renderSearch();

    expect(result.current.searched).toBe(false);
    expect(result.current.apiParams).toEqual({
      train_number: "",
      departure_date: "",
    });
    expect(result.current.validity.status).toBe("idle");
  });

  it("submits on submit only when the query resolves", () => {
    const { result } = renderSearch();

    act(() => result.current.setValue("22943"));
    act(() => result.current.handleSubmit());

    expect(result.current.searched).toBe(true);
    expect(result.current.apiParams.train_number).toBe("22943");
  });

  it("does NOT submit when the query is incomplete", () => {
    const { result } = renderSearch();

    act(() => result.current.setValue("2294"));
    act(() => result.current.handleSubmit());

    expect(result.current.searched).toBe(false);
  });

  it("submits immediately when a train is selected while typing", () => {
    const { result } = renderSearch();

    act(() => result.current.setValue("2294"));
    act(() => result.current.setSelected(TRAINS[0]));

    expect(result.current.searched).toBe(true);
    expect(result.current.apiParams.train_number).toBe("22943");
  });

  it("submits and records a recent when a recent chip is selected", () => {
    const { result, addRecent } = renderSearch();

    act(() => result.current.handleSelectRecent(TRAINS[1]));

    expect(result.current.searched).toBe(true);
    expect(result.current.apiParams.train_number).toBe("12951");
    expect(addRecent).toHaveBeenCalledWith(TRAINS[1]);
  });

  it("reset returns the hook to its initial idle state", () => {
    const { result } = renderSearch();

    act(() => result.current.setValue("22943"));
    act(() => result.current.handleSubmit());
    act(() => result.current.reset());

    expect(result.current.searched).toBe(false);
    expect(result.current.value).toBe("");
    expect(result.current.apiParams).toEqual({
      train_number: "",
      departure_date: "",
    });
  });

  it("selectDate sets the departure date and marks the choice as user-made", () => {
    const { result } = renderSearch();

    act(() => result.current.setValue("22943"));
    act(() => result.current.handleSubmit());

    expect(result.current.userPickedDate).toBe(false);

    act(() => result.current.selectDate("20260727"));

    expect(result.current.userPickedDate).toBe(true);
    expect(result.current.apiParams.departure_date).toBe("20260727");
  });

  it("setDepartureDate changes the date without marking it user-made", () => {
    const { result } = renderSearch();

    act(() => result.current.setValue("22943"));
    act(() => result.current.handleSubmit());
    act(() => result.current.setDepartureDate("20260803"));

    expect(result.current.userPickedDate).toBe(false);
    expect(result.current.apiParams.departure_date).toBe("20260803");
  });

  it("reset clears the user-picked date flag", () => {
    const { result } = renderSearch();

    act(() => result.current.setValue("22943"));
    act(() => result.current.handleSubmit());
    act(() => result.current.selectDate("20260727"));
    act(() => result.current.reset());

    expect(result.current.userPickedDate).toBe(false);
  });
});

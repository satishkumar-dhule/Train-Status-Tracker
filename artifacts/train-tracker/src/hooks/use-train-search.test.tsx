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
    expect(result.current.userPickedDate).toBe(false);
  });

  it("submits on the search-form submit only when the query resolves", () => {
    const { result } = renderSearch();
    act(() => result.current.setTrainNo("22943"));
    act(() => result.current.handleSearchFormSubmit());
    expect(result.current.searched).toBe(true);
    expect(result.current.apiParams.train_number).toBe("22943");
  });

  it("does NOT submit when the query is incomplete", () => {
    const { result } = renderSearch();
    act(() => result.current.setTrainNo("2294"));
    act(() => result.current.handleSearchFormSubmit());
    expect(result.current.searched).toBe(false);
  });

  it("submits immediately when a train is selected while typing", () => {
    const { result } = renderSearch();
    act(() => result.current.setTrainNo("2294"));
    act(() => result.current.setSelectedTrain(TRAINS[0]));
    expect(result.current.searched).toBe(true);
    expect(result.current.apiParams.train_number).toBe("22943");
  });

  it("submits and records a recent when a recent chip is selected", () => {
    const { result, addRecent } = renderSearch();
    act(() => result.current.handleSelectRecent(TRAINS[1]));
    expect(addRecent).toHaveBeenCalledWith(TRAINS[1]);
    expect(result.current.searched).toBe(true);
    expect(result.current.apiParams.train_number).toBe("12951");
  });

  it("submits when a train is selected from the results header suggestions", () => {
    const { result } = renderSearch();
    act(() => result.current.setTrainNo("22943"));
    act(() => result.current.handleSearchFormSubmit());
    act(() => result.current.setHeaderNo("12951"));
    act(() => result.current.setHeaderSelected(TRAINS[1]));
    expect(result.current.apiParams.train_number).toBe("12951");
    expect(result.current.headerNo).toBe("");
  });

  it("ignores selecting the currently shown train in the results header", () => {
    const { result } = renderSearch();
    act(() => result.current.setTrainNo("22943"));
    act(() => result.current.handleSearchFormSubmit());
    act(() => result.current.setHeaderSelected(TRAINS[0]));
    expect(result.current.apiParams.train_number).toBe("22943");
  });

  it("selectDate marks the date as user-picked and updates params", () => {
    const { result } = renderSearch();
    act(() => result.current.setTrainNo("22943"));
    act(() => result.current.handleSearchFormSubmit());
    act(() => result.current.selectDate("20260806"));
    expect(result.current.apiParams.departure_date).toBe("20260806");
  });

  it("reset returns the hook to its initial idle state", () => {
    const { result } = renderSearch();
    act(() => result.current.setTrainNo("22943"));
    act(() => result.current.handleSearchFormSubmit());
    act(() => result.current.setHeaderNo("12951"));
    act(() => result.current.reset());
    expect(result.current.searched).toBe(false);
    expect(result.current.trainNo).toBe("");
    expect(result.current.headerNo).toBe("");
    expect(result.current.apiParams).toEqual({
      train_number: "",
      departure_date: "",
    });
  });
});

// @vitest-environment jsdom

import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useTrainRuns } from "./use-train-runs";

const mocks = vi.hoisted(() => ({
  useGetTrainRuns: vi.fn(),
  getGetTrainRunsQueryKey: vi.fn(
    (params?: unknown) => ["/api/trains/runs", params],
  ),
}));

vi.mock("@workspace/api-client-react", () => mocks);

const RUNS = ["20260727", "20260730", "20260803", "20260806"];

beforeEach(() => {
  mocks.useGetTrainRuns.mockReset();
  mocks.getGetTrainRunsQueryKey.mockReset();
  mocks.getGetTrainRunsQueryKey.mockImplementation(
    (params?: unknown) => ["/api/trains/runs", params],
  );
});

describe("useTrainRuns", () => {
  it("exposes the run dates from a successful query", () => {
    mocks.useGetTrainRuns.mockReturnValue({
      data: { train_number: "22943", runs: RUNS },
      isFetching: false,
      isError: false,
      error: null,
    });

    const { result } = renderHook(() => useTrainRuns("22943"));

    expect(result.current.runs).toEqual(RUNS);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("reports loading while there is no data yet", () => {
    mocks.useGetTrainRuns.mockReturnValue({
      data: undefined,
      isFetching: true,
      isError: false,
      error: null,
    });

    const { result } = renderHook(() => useTrainRuns("22943"));

    expect(result.current.runs).toBeUndefined();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isError).toBe(false);
  });

  it("reports an error without crashing", () => {
    mocks.useGetTrainRuns.mockReturnValue({
      data: undefined,
      isFetching: false,
      isError: true,
      error: new TypeError("Failed to fetch"),
    });

    const { result } = renderHook(() => useTrainRuns("22943"));

    expect(result.current.runs).toBeUndefined();
    expect(result.current.isError).toBe(true);
  });

  it("null train number: query disabled and empty query key", () => {
    mocks.useGetTrainRuns.mockReturnValue({
      data: undefined,
      isFetching: false,
      isError: false,
      error: null,
    });

    renderHook(() => useTrainRuns(null));

    expect(mocks.useGetTrainRuns).toHaveBeenCalledTimes(1);
    const [params, options] = mocks.useGetTrainRuns.mock.calls[0];
    expect(params).toEqual({ train_number: "" });
    expect(options.query.enabled).toBe(false);
    expect(options.query.queryKey).toEqual([]);
  });

  it("enabled train number: query enabled with a real query key", () => {
    mocks.useGetTrainRuns.mockReturnValue({
      data: { train_number: "22943", runs: RUNS },
      isFetching: false,
      isError: false,
      error: null,
    });

    renderHook(() => useTrainRuns("22943"));

    expect(mocks.useGetTrainRuns).toHaveBeenCalledTimes(1);
    const [params, options] = mocks.useGetTrainRuns.mock.calls[0];
    expect(params).toEqual({ train_number: "22943" });
    expect(options.query.enabled).toBe(true);
    expect(options.query.queryKey).toEqual(
      mocks.getGetTrainRunsQueryKey({ train_number: "22943" }),
    );
    expect(options.query.retry).toBe(false);
    expect(options.query.refetchOnWindowFocus).toBe(false);
  });
});

// @vitest-environment jsdom

import { describe, expect, it, beforeEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { keepPreviousData } from "@tanstack/react-query";
import type { TrainStatusResponse } from "@workspace/api-client-react";
import { useTrainStatus } from "./use-train-status";

const mocks = vi.hoisted(() => ({
  useGetTrainStatus: vi.fn(),
  getGetTrainStatusQueryKey: vi.fn(
    (params?: unknown) => ["/api/trains/status", params],
  ),
  getGetTrainStatusQueryOptions: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => mocks);

const PARAMS = { train_number: "22943", departure_date: "20260801" };

const RESPONSE: TrainStatusResponse = {
  train_number: "22943",
  train_name: "Indore Intercity SF Express",
  departure_date: "20260801",
  source_station_code: "INDB",
  source_station_name: "Indore Jn",
  destination_station_code: "BPL",
  destination_station_name: "Bhopal Jn",
  current_station_code: "UJN",
  current_station_name: "Ujjain Jn",
  current_delay_minutes: 10,
  status_message: "Running late by 10 minutes",
  last_updated: "2026-08-01T12:00:00Z",
  stations: [],
};

const API_ERROR_404 = {
  name: "ApiError",
  status: 404,
  statusText: "Not Found",
  data: { error: "Train not found" },
};

const API_ERROR_502 = {
  name: "ApiError",
  status: 502,
  statusText: "Bad Gateway",
  data: { error: "Upstream provider unreachable" },
};

interface MockQuery {
  data?: TrainStatusResponse;
  isFetching: boolean;
  isError: boolean;
  error?: unknown;
}

function mockQuery(query: MockQuery) {
  mocks.useGetTrainStatus.mockReturnValue({
    data: query.data,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error ?? null,
  });
}

beforeEach(() => {
  mocks.useGetTrainStatus.mockReset();
  mocks.getGetTrainStatusQueryKey.mockReset();
  mocks.getGetTrainStatusQueryKey.mockImplementation(
    (params?: unknown) => ["/api/trains/status", params],
  );
});

describe("useTrainStatus", () => {
  it("success: exposes data and isLoading only while there is no data yet", () => {
    mocks.useGetTrainStatus
      .mockReturnValueOnce({
        data: undefined,
        isFetching: true,
        isError: false,
        error: null,
      })
      .mockReturnValue({
        data: RESPONSE,
        isFetching: false,
        isError: false,
        error: null,
      });

    const { result, rerender } = renderHook(
      ({ params }: { params: typeof PARAMS }) => useTrainStatus(params),
      { initialProps: { params: PARAMS } },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
    expect(result.current.messageKey).toBeNull();

    rerender({ params: PARAMS });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetching).toBe(false);
    expect(result.current.data).toBe(RESPONSE);
    expect(result.current.isError).toBe(false);
    expect(result.current.isNotFound).toBe(false);
    expect(result.current.isProviderError).toBe(false);
    expect(result.current.isNetworkError).toBe(false);
    expect(result.current.messageKey).toBeNull();
  });

  it("404 error object: isNotFound true and messageKey points to the not-found key", () => {
    mockQuery({ data: undefined, isFetching: false, isError: true, error: API_ERROR_404 });

    const { result } = renderHook(() => useTrainStatus(PARAMS));

    expect(result.current.isError).toBe(true);
    expect(result.current.isNotFound).toBe(true);
    expect(result.current.isProviderError).toBe(false);
    expect(result.current.isNetworkError).toBe(false);
    expect(result.current.messageKey).toBe("error.trainNotFound");
  });

  it("5xx error object: isProviderError true", () => {
    mockQuery({ data: undefined, isFetching: false, isError: true, error: API_ERROR_502 });

    const { result } = renderHook(() => useTrainStatus(PARAMS));

    expect(result.current.isProviderError).toBe(true);
    expect(result.current.isNotFound).toBe(false);
    expect(result.current.isNetworkError).toBe(false);
    expect(result.current.messageKey).toBe("error.providerUnreachable");
  });

  it("network-like error: isNetworkError true", () => {
    const networkError = new TypeError("Failed to fetch");
    mockQuery({ data: undefined, isFetching: false, isError: true, error: networkError });

    const { result } = renderHook(() => useTrainStatus(PARAMS));

    expect(result.current.isNetworkError).toBe(true);
    expect(result.current.isNotFound).toBe(false);
    expect(result.current.isProviderError).toBe(false);
    expect(result.current.messageKey).toBe("error.fallback");
  });

  it("passes keepPreviousData as placeholderData and builds the query key via getGetTrainStatusQueryKey", () => {
    mockQuery({ data: RESPONSE, isFetching: false, isError: false });

    renderHook(() => useTrainStatus(PARAMS));

    expect(mocks.useGetTrainStatus).toHaveBeenCalledTimes(1);
    const [params, options] = mocks.useGetTrainStatus.mock.calls[0];
    expect(params).toEqual(PARAMS);
    expect(options.query.queryKey).toEqual(
      mocks.getGetTrainStatusQueryKey(PARAMS),
    );
    expect(mocks.getGetTrainStatusQueryKey).toHaveBeenCalledWith(PARAMS);
    expect(options.query.placeholderData).toBe(keepPreviousData);
    expect(options.query.retry).toBe(false);
    expect(options.query.refetchOnWindowFocus).toBe(false);
    expect(options.query.enabled).toBe(true);
  });

  it("params null: query not enabled and empty query key", () => {
    mockQuery({ data: undefined, isFetching: false, isError: false });

    const { result } = renderHook(() => useTrainStatus(null));

    expect(mocks.useGetTrainStatus).toHaveBeenCalledTimes(1);
    const [params, options] = mocks.useGetTrainStatus.mock.calls[0];
    expect(params).toEqual({ train_number: "", departure_date: "" });
    expect(options.query.enabled).toBe(false);
    expect(options.query.queryKey).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toBeUndefined();
  });

  it("enabled=false forces the query off even with valid params", () => {
    mockQuery({ data: undefined, isFetching: false, isError: false });

    renderHook(() => useTrainStatus(PARAMS, false));

    const [params, options] = mocks.useGetTrainStatus.mock.calls[0];
    expect(params).toEqual(PARAMS);
    expect(options.query.enabled).toBe(false);
  });
});

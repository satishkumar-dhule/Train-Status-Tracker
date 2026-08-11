// @vitest-environment jsdom

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TrainStatusResponse } from "@workspace/api-client-react";
import {
  formatShortDate,
  fromApiDate,
  getUpcomingDates,
  pickDefaultRunDate,
  toApiDate,
} from "@workspace/trains-data";
import { GATEWAY_AUTO } from "@/components/gateway-selector";
import { useJourney } from "./journey-slice";
import type { RunTab } from "./journey-slice";

const mocks = vi.hoisted(() => ({
  useTrainRuns: vi.fn(),
  useTrainStatus: vi.fn(),
  useTrainProviders: vi.fn(),
}));

vi.mock("../../hooks/use-train-runs", () => ({
  useTrainRuns: mocks.useTrainRuns,
}));
vi.mock("../../hooks/use-train-status", () => ({
  useTrainStatus: mocks.useTrainStatus,
}));
vi.mock("../../hooks/use-train-providers", () => ({
  useTrainProviders: mocks.useTrainProviders,
}));

const TODAY_API = "20260807";
const RUNS = ["20260727", "20260731", "20260803", TODAY_API, "20260810"];
const NEXT_RUN = "20260810";

const RESPONSE: TrainStatusResponse = {
  train_number: "22943",
  train_name: "Indore Intercity SF Express",
  departure_date: TODAY_API,
  source_station_code: "INDB",
  source_station_name: "Indore Jn",
  destination_station_code: "BPL",
  destination_station_name: "Bhopal Jn",
  current_station_code: "UJN",
  current_station_name: "Ujjain Jn",
  current_delay_minutes: 10,
  status_message: "Running late by 10 minutes",
  last_updated: "2026-08-07T12:00:00Z",
  provider: "paytm",
  stations: [],
};

let refetchMock: ReturnType<typeof vi.fn>;

function mockStatus(options: {
  data?: TrainStatusResponse | undefined;
  isLoading?: boolean;
  isFetching?: boolean;
  isPlaceholderData?: boolean;
  isError?: boolean;
  errorType?: "not-found" | "provider" | "network" | null;
}) {
  const {
    data = RESPONSE,
    isLoading = data === undefined && options.isFetching,
    isFetching = false,
    isPlaceholderData = false,
    isError = false,
    errorType = null,
  } = options;
  mocks.useTrainStatus.mockReturnValue({
    data,
    isLoading,
    isFetching,
    isPlaceholderData,
    isError,
    errorType,
    refetch: refetchMock,
  });
}

function lastStatusCall() {
  const call = mocks.useTrainStatus.mock.calls.at(-1);
  expect(call).toBeDefined();
  return call!;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-07T12:00:00"));
  expect(toApiDate(getUpcomingDates(1)[0])).toBe(TODAY_API);
  mocks.useTrainRuns.mockReset();
  mocks.useTrainRuns.mockImplementation((train: string | null) =>
    train
      ? { runs: RUNS, isLoading: false, isError: false }
      : { runs: undefined, isLoading: false, isError: false },
  );
  refetchMock = vi.fn(async () => undefined);
  mocks.useTrainStatus.mockReset();
  mockStatus({});
  mocks.useTrainProviders.mockReset();
  mocks.useTrainProviders.mockReturnValue({
    gateways: ["paytm", "goibibo"],
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useJourney", () => {
  it("lands on the recommended run date (pickDefaultRunDate) by default", () => {
    expect(pickDefaultRunDate(RUNS)).toBe(TODAY_API);

    const { result } = renderHook(() => useJourney("22943"));

    expect(result.current.activeDate).toBe(pickDefaultRunDate(RUNS));
    expect(result.current.selected).toEqual({
      trainNumber: "22943",
      departureDate: pickDefaultRunDate(RUNS),
    });
    expect(result.current.userPickedDate).toBe(false);
    expect(result.current.runs).toEqual(RUNS);
    expect(result.current.runsError).toBe(false);
  });

  it("builds the run tabs from runs with Today/Next/short-date labels", () => {
    const { result } = renderHook(() => useJourney("22943"));

    const expected: RunTab[] = [
      {
        apiDate: "20260731",
        iso: fromApiDate("20260731"),
        label: formatShortDate(fromApiDate("20260731")),
        isDefault: false,
        isSelected: false,
      },
      {
        apiDate: "20260803",
        iso: fromApiDate("20260803"),
        label: formatShortDate(fromApiDate("20260803")),
        isDefault: false,
        isSelected: false,
      },
      {
        apiDate: TODAY_API,
        iso: fromApiDate(TODAY_API),
        label: "Today",
        isDefault: true,
        isSelected: true,
      },
      {
        apiDate: NEXT_RUN,
        iso: fromApiDate(NEXT_RUN),
        label: "Next",
        isDefault: false,
        isSelected: false,
      },
    ];
    expect(result.current.dates).toEqual(expected);
  });

  it("returns an empty dates list while runs are unknown or empty", () => {
    mocks.useTrainRuns.mockReturnValue({
      runs: undefined,
      isLoading: true,
      isError: false,
    });
    const { result } = renderHook(() => useJourney("22943"));
    expect(result.current.dates).toEqual([]);
    expect(result.current.runs).toBeUndefined();

    mocks.useTrainRuns.mockReturnValue({
      runs: [],
      isLoading: false,
      isError: false,
    });
    const { result: empty } = renderHook(() => useJourney("22943"));
    expect(empty.current.dates).toEqual([]);
  });

  it("handles runs with no future run", () => {
    mocks.useTrainRuns.mockReturnValue({
      runs: ["20260727", "20260731", "20260803", TODAY_API],
      isLoading: false,
      isError: false,
    });
    const { result } = renderHook(() => useJourney("22943"));

    expect(result.current.dates.at(-1)?.label).toBe("Today");
    expect(result.current.dates.some((date) => date.label === "Next")).toBe(
      false,
    );
    expect(result.current.dates).toHaveLength(3);
  });

  it("handles runs that are all in the future by landing on the next run", () => {
    mocks.useTrainRuns.mockReturnValue({
      runs: [NEXT_RUN, "20260814"],
      isLoading: false,
      isError: false,
    });
    const { result } = renderHook(() => useJourney("22943"));

    expect(pickDefaultRunDate([NEXT_RUN, "20260814"])).toBe(NEXT_RUN);
    expect(result.current.activeDate).toBe(NEXT_RUN);
    expect(result.current.dates).toEqual([
      {
        apiDate: NEXT_RUN,
        iso: fromApiDate(NEXT_RUN),
        label: "Next",
        isDefault: true,
        isSelected: true,
      },
    ]);
  });

  it("selectDate marks the choice user-made and moves the status query", () => {
    const { result } = renderHook(() => useJourney("22943"));

    act(() => {
      result.current.selectDate(NEXT_RUN);
    });

    expect(result.current.userPickedDate).toBe(true);
    expect(result.current.activeDate).toBe(NEXT_RUN);
    expect(result.current.selected).toEqual({
      trainNumber: "22943",
      departureDate: NEXT_RUN,
    });
    expect(
      result.current.dates.find((date) => date.apiDate === NEXT_RUN)
        ?.isSelected,
    ).toBe(true);

    const [params, enabled] = lastStatusCall();
    expect(params).toEqual({
      train_number: "22943",
      departure_date: NEXT_RUN,
      provider: undefined,
    });
    expect(enabled).toBe(true);
  });

  it("never overrides a date the user picked when runs change", () => {
    const { result, rerender } = renderHook(() => useJourney("22943"));

    act(() => {
      result.current.selectDate(NEXT_RUN);
    });
    rerender();

    expect(result.current.activeDate).toBe(NEXT_RUN);
    expect(result.current.userPickedDate).toBe(true);
  });

  it("gateway defaults to GATEWAY_AUTO and setGateway updates the provider", () => {
    const { result } = renderHook(() => useJourney("22943"));

    expect(result.current.gateway).toBe(GATEWAY_AUTO);
    expect(result.current.gateways).toEqual(["paytm", "goibibo"]);

    act(() => {
      result.current.setGateway("paytm");
    });

    expect(result.current.gateway).toBe("paytm");
    const [params, enabled] = lastStatusCall();
    expect(params).toEqual({
      train_number: "22943",
      departure_date: TODAY_API,
      provider: "paytm",
    });
    expect(enabled).toBe(true);
  });

  it("enables the status query only once the active date is a known run", () => {
    const { result } = renderHook(() => useJourney("22943"));
    const [params, enabled] = lastStatusCall();
    expect(params).toEqual({
      train_number: "22943",
      departure_date: TODAY_API,
      provider: undefined,
    });
    expect(enabled).toBe(true);

    act(() => {
      result.current.selectDate("20260808");
    });
    const [pickedParams, pickedEnabled] = lastStatusCall();
    expect(pickedParams).toEqual({
      train_number: "22943",
      departure_date: "20260808",
      provider: undefined,
    });
    expect(pickedEnabled).toBe(false);
  });

  it("holds the status query while runs are still loading", () => {
    mocks.useTrainRuns.mockReturnValue({
      runs: undefined,
      isLoading: true,
      isError: false,
    });
    renderHook(() => useJourney("22943"));

    const [params, enabled] = lastStatusCall();
    expect(params).toEqual({
      train_number: "22943",
      departure_date: TODAY_API,
      provider: undefined,
    });
    expect(enabled).toBe(false);
  });

  it("fails open to the selected date on runs error or an empty schedule", () => {
    mocks.useTrainRuns.mockReturnValue({
      runs: undefined,
      isLoading: false,
      isError: true,
    });
    renderHook(() => useJourney("22943"));
    expect(lastStatusCall()[1]).toBe(true);

    mocks.useTrainRuns.mockReturnValue({
      runs: [],
      isLoading: false,
      isError: false,
    });
    renderHook(() => useJourney("22943"));
    expect(lastStatusCall()[1]).toBe(true);
  });

  it("trainNumber null: no selection, empty dates, disabled status query", () => {
    const { result } = renderHook(() => useJourney(null));

    expect(result.current.selected).toBeNull();
    expect(result.current.dates).toEqual([]);
    expect(result.current.runs).toBeUndefined();
    expect(result.current.activeDate).toBe(TODAY_API);

    const [params, enabled] = lastStatusCall();
    expect(params).toBeNull();
    expect(enabled).toBe(false);
  });

  it("passes through status errorType mappings", () => {
    mockStatus({
      data: undefined,
      isFetching: false,
      isError: true,
      errorType: "not-found",
    });
    const { result: notFound } = renderHook(() => useJourney("22943"));
    expect(notFound.current.status.isError).toBe(true);
    expect(notFound.current.status.errorType).toBe("not-found");

    mockStatus({
      data: undefined,
      isFetching: false,
      isError: true,
      errorType: "provider",
    });
    const { result: provider } = renderHook(() => useJourney("22943"));
    expect(provider.current.status.errorType).toBe("provider");

    mockStatus({
      data: undefined,
      isFetching: false,
      isError: true,
      errorType: "network",
    });
    const { result: network } = renderHook(() => useJourney("22943"));
    expect(network.current.status.errorType).toBe("network");
  });

  it("status.errorType is null while loading", () => {
    mockStatus({
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      errorType: null,
    });
    const { result } = renderHook(() => useJourney("22943"));

    expect(result.current.status.isLoading).toBe(true);
    expect(result.current.status.isError).toBe(false);
    expect(result.current.status.errorType).toBeNull();
  });

  it("refresh and status.refetch both hit the underlying query refetch", () => {
    const { result } = renderHook(() => useJourney("22943"));

    act(() => {
      result.current.refresh();
    });
    expect(refetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.status.refetch();
    });
    expect(refetchMock).toHaveBeenCalledTimes(2);
  });

  it("autoRefresh is opt-in: off by default with the 5-minute cadence", () => {
    const { result } = renderHook(() => useJourney("22943"));

    expect(result.current.autoRefresh.enabled).toBe(false);
    expect(result.current.autoRefresh.cadenceMs).toBe(5 * 60_000);
  });

  it("setEnabled(true) silently refetches status every cadence and stops when disabled", () => {
    const { result } = renderHook(() => useJourney("22943"));

    act(() => {
      result.current.autoRefresh.setEnabled(true);
    });
    expect(refetchMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(refetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(refetchMock).toHaveBeenCalledTimes(2);

    act(() => {
      result.current.autoRefresh.setEnabled(false);
    });
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });
    expect(refetchMock).toHaveBeenCalledTimes(2);
  });

  it("setCadence changes the polling cadence", () => {
    const { result } = renderHook(() => useJourney("22943"));

    act(() => {
      result.current.autoRefresh.setEnabled(true);
      result.current.autoRefresh.setCadence(1000);
    });
    expect(result.current.autoRefresh.cadenceMs).toBe(1000);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(refetchMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(refetchMock).toHaveBeenCalledTimes(1);
  });

  it("resets the polling interval when the selected date or train changes", () => {
    const { result, rerender } = renderHook(
      ({ train }: { train: string | null }) => useJourney(train),
      { initialProps: { train: "22943" } },
    );

    act(() => {
      result.current.autoRefresh.setEnabled(true);
    });
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(refetchMock).not.toHaveBeenCalled();

    act(() => {
      result.current.selectDate(NEXT_RUN);
    });
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(refetchMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(refetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(refetchMock).toHaveBeenCalledTimes(1);

    rerender({ train: "12002" });
    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(refetchMock).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(3 * 60_000);
    });
    expect(refetchMock).toHaveBeenCalledTimes(2);
  });

  it("stops polling on unmount", () => {
    const { result, unmount } = renderHook(() => useJourney("22943"));

    act(() => {
      result.current.autoRefresh.setEnabled(true);
    });
    unmount();

    act(() => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(refetchMock).not.toHaveBeenCalled();
  });

  it("skips the refetch tick when no train is selected", () => {
    const { result, rerender } = renderHook(
      ({ train }: { train: string | null }) => useJourney(train),
      { initialProps: { train: "22943" } },
    );

    act(() => {
      result.current.autoRefresh.setEnabled(true);
    });
    rerender({ train: null });
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(refetchMock).not.toHaveBeenCalled();
  });

  it("polling does not churn autoRefresh state", () => {
    const { result } = renderHook(() => useJourney("22943"));

    act(() => {
      result.current.autoRefresh.setEnabled(true);
    });
    act(() => {
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(refetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.autoRefresh.enabled).toBe(true);
    expect(result.current.autoRefresh.cadenceMs).toBe(5 * 60_000);
    expect(result.current.status.isLoading).toBe(false);
  });
});

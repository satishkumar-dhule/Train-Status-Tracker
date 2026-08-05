// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainEntry } from "@workspace/trains-data";
import { TRAINS } from "@workspace/trains-data";
import { TRAIN_CATALOG_TTL_MS } from "./use-train-catalog";

const mocks = vi.hoisted(() => ({
  getTrainCatalog: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => mocks);

const CATALOG: TrainEntry[] = [
  { number: "12001", name: "Bhopal Shatabdi Express" },
  { number: "22943", name: "Indore Intercity SF Express" },
  { number: "99901", name: "NTES Only Rocket" },
];

/** Re-import the hook so each test starts with an empty module-level cache. */
async function importHook() {
  vi.resetModules();
  return await import("./use-train-catalog");
}

async function flush() {
  await act(async () => {});
}

describe("useTrainCatalog", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("starts in the loading state with the bundled fallback, then serves the fetched catalog", async () => {
    mocks.getTrainCatalog.mockResolvedValue({ trains: CATALOG });
    const { useTrainCatalog } = await importHook();

    const { result } = renderHook(() => useTrainCatalog());
    expect(result.current).toMatchObject({
      trains: TRAINS,
      isLoading: true,
      isError: false,
    });

    await flush();

    expect(result.current.trains).toEqual(CATALOG);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  it("falls back to the bundled list when the API is unreachable", async () => {
    mocks.getTrainCatalog.mockRejectedValue(new TypeError("fetch failed"));
    const { useTrainCatalog } = await importHook();

    const { result } = renderHook(() => useTrainCatalog());
    await flush();

    expect(result.current.trains).toEqual(TRAINS);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(true);
  });

  it("dedupes the fetched catalog by number", async () => {
    mocks.getTrainCatalog.mockResolvedValue({
      trains: [
        { number: "12001", name: "Bhopal Shatabdi Express" },
        { number: "12001", name: "Duplicate" },
      ],
    });
    const { useTrainCatalog } = await importHook();

    const { result } = renderHook(() => useTrainCatalog());
    await flush();

    expect(result.current.trains).toEqual([
      { number: "12001", name: "Bhopal Shatabdi Express" },
    ]);
  });

  it("single-flights concurrent mounters into one request and shares the cached list", async () => {
    let resolve!: (value: { trains: TrainEntry[] }) => void;
    const deferred = new Promise<{ trains: TrainEntry[] }>((res) => {
      resolve = res;
    });
    mocks.getTrainCatalog.mockReturnValue(deferred);

    const { useTrainCatalog } = await importHook();

    const a = renderHook(() => useTrainCatalog());
    const b = renderHook(() => useTrainCatalog());

    expect(mocks.getTrainCatalog).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ trains: CATALOG });
    });
    await flush();

    expect(a.result.current.trains).toEqual(CATALOG);
    expect(b.result.current.trains).toEqual(CATALOG);
  });

  it("keeps serving the cached list within the 2h TTL without refetching", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00Z"));
    mocks.getTrainCatalog.mockResolvedValue({ trains: CATALOG });
    const { useTrainCatalog } = await importHook();

    const first = renderHook(() => useTrainCatalog());
    await flush();
    expect(first.result.current.trains).toEqual(CATALOG);
    expect(mocks.getTrainCatalog).toHaveBeenCalledTimes(1);
    first.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAIN_CATALOG_TTL_MS - 1);
    });
    const second = renderHook(() => useTrainCatalog());
    await flush();
    expect(second.result.current.trains).toEqual(CATALOG);
    expect(mocks.getTrainCatalog).toHaveBeenCalledTimes(1);
    second.unmount();
  });

  it("re-fetches once the 2h TTL expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:00:00Z"));
    mocks.getTrainCatalog.mockResolvedValue({ trains: CATALOG });
    const { useTrainCatalog } = await importHook();

    const first = renderHook(() => useTrainCatalog());
    await flush();
    expect(mocks.getTrainCatalog).toHaveBeenCalledTimes(1);
    first.unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(TRAIN_CATALOG_TTL_MS + 1);
    });
    const second = renderHook(() => useTrainCatalog());
    await flush();
    expect(mocks.getTrainCatalog).toHaveBeenCalledTimes(2);
    expect(second.result.current.trains).toEqual(CATALOG);
    second.unmount();
  });

  it("does not update state after unmount", async () => {
    mocks.getTrainCatalog.mockResolvedValue({ trains: CATALOG });
    const { useTrainCatalog } = await importHook();

    const { unmount } = renderHook(() => useTrainCatalog());
    unmount();
    await flush();

    expect(mocks.getTrainCatalog).toHaveBeenCalledTimes(1);
  });
});

describe("TRAIN_CATALOG_TTL_MS", () => {
  it("is 2 hours", () => {
    expect(TRAIN_CATALOG_TTL_MS).toBe(2 * 60 * 60 * 1000);
  });
});

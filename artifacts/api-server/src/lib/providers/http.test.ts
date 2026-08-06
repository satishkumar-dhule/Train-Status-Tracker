import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TrainStatusNotFoundError,
  TrainStatusUpstreamError,
} from "./errors";
import { fetchProviderStatus } from "./http";
import type { MappedStatus } from "../train-status-mapper";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

const mapped: MappedStatus = {
  train_number: "22943",
  train_name: "Train 22943",
  departure_date: "20260802",
  source_station_code: "ADI",
  source_station_name: "",
  destination_station_code: "NDLS",
  destination_station_name: "",
  current_station_code: null,
  current_station_name: null,
  current_delay_minutes: null,
  status_message: null,
  last_updated: null,
  stations: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProviderStatus", () => {
  it("returns the mapped status on success", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ ok: true }));
    const map = vi.fn(() => mapped);

    const result = await fetchProviderStatus(
      {
        provider: "test",
        url: "https://example.com/status?train_number=22943",
        responseType: "json",
        map,
      },
      { fetchImpl: fetchSpy },
    );

    expect(result).toBe(mapped);
    expect(map).toHaveBeenCalledWith({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("passes the external abort signal through", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (
      _input: string | URL,
      init?: RequestInit,
    ) => {
      seenSignal = init?.signal ?? undefined;
      return jsonResponse({ ok: true });
    };

    await fetchProviderStatus(
      { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
      { fetchImpl, signal: controller.signal },
    );

    expect(seenSignal).toBeDefined();
    expect(seenSignal).not.toBe(controller.signal);
  });

  it("throws TrainStatusUpstreamError when fetch rejects", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(
      fetchProviderStatus(
        { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("throws TrainStatusUpstreamError on non-200 status", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("boom", { status: 500 });

    await expect(
      fetchProviderStatus(
        { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("throws TrainStatusUpstreamError on invalid JSON", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("<html>oops</html>", { status: 200 });

    await expect(
      fetchProviderStatus(
        { provider: "test", url: "https://example.com", responseType: "json", map: () => mapped },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("preserves a not-found thrown by the mapper", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});

    await expect(
      fetchProviderStatus(
        {
          provider: "test",
          url: "https://example.com",
          responseType: "json",
          map: () => {
            throw new TrainStatusNotFoundError("test", "nope");
          },
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusNotFoundError);
  });

  it("preserves an upstream error thrown by the mapper", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});

    await expect(
      fetchProviderStatus(
        {
          provider: "test",
          url: "https://example.com",
          responseType: "json",
          map: () => {
            throw new TrainStatusUpstreamError("test", "shape changed");
          },
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });

  it("wraps an unexpected mapper error as an upstream error", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({});

    await expect(
      fetchProviderStatus(
        {
          provider: "test",
          url: "https://example.com",
          responseType: "json",
          map: () => {
            throw new Error("boom");
          },
        },
        { fetchImpl },
      ),
    ).rejects.toThrow(TrainStatusUpstreamError);
  });
});

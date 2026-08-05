import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPaytmTrainStatus,
  PaytmTrainNotFoundError,
  PaytmUpstreamError,
} from "./paytm-client";

const TRAIN_NUMBER = "22943";
const DEPARTURE_DATE = "20260802";

const happyRaw = {
  status: { result: "success" },
  body: {
    stations: [
      {
        stnSerialNumber: 1,
        stationCode: "ADI",
        stationName: "Ahmedabad Jn",
        arrivalTime: "22:40",
        departureTime: "23:00",
        dayCount: 1,
        distance: 0,
        expected_platform: 1,
        haltTime: 20,
      },
      {
        stnSerialNumber: 2,
        stationCode: "NDLS",
        stationName: "New Delhi",
        arrivalTime: "08:05",
        departureTime: "08:15",
        dayCount: 2,
        actual_arrival_time: "08:40",
        actual_departure_time: null,
        distance: 938,
        expected_platform: "3",
        haltTime: 10,
      },
    ],
    current_station: "NDLS",
    train_status_message: "<b>Running on time</b>",
    server_timestamp: "2026-08-02T08:20:00+05:30",
  },
};

const expectedPayload = {
  stations: happyRaw.body.stations,
  current_station: "NDLS",
  train_status_message: "<b>Running on time</b>",
  server_timestamp: "2026-08-02T08:20:00+05:30",
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPaytmTrainStatus", () => {
  it("returns a typed payload on success", async () => {
    const fetchSpy = vi.fn(
      async (_input: string | URL, _init?: RequestInit) =>
        jsonResponse(happyRaw),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const payload = await fetchPaytmTrainStatus(
      TRAIN_NUMBER,
      DEPARTURE_DATE,
    );

    expect(payload).toEqual(expectedPayload);
    expect(payload.stations[0].haltTime).toBe(20);
    expect(payload.stations[1].distance).toBe(938);
    expect(payload.stations[1].expected_platform).toBe("3");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("leaves station fields raw", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        status: { result: "success" },
        body: {
          stations: [
            {
              stnSerialNumber: "42",
              stationCode: 123,
              distance: "100",
              expected_platform: 7,
            },
          ],
          current_station: null,
        },
      });

    const payload = await fetchPaytmTrainStatus(
      TRAIN_NUMBER,
      DEPARTURE_DATE,
      { fetchImpl },
    );

    expect(payload.stations[0]).toEqual({
      stnSerialNumber: "42",
      stationCode: 123,
      distance: "100",
      expected_platform: 7,
    });
    expect(payload.current_station).toBeNull();
  });

  it("throws PaytmUpstreamError when fetch rejects (network error)", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };

    await expect(
      fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, { fetchImpl }),
    ).rejects.toThrow(PaytmUpstreamError);
  });

  it("throws PaytmUpstreamError when the internal timeout aborts the request", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const fetchImpl: typeof fetch = async (
      _input: string | URL,
      init?: RequestInit,
    ) => {
      seenSignal = init?.signal ?? undefined;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("The operation was aborted.", "AbortError")),
        );
      });
    };

    const promise = fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, {
      fetchImpl,
      signal: controller.signal,
    });

    expect(seenSignal).toBeDefined();
    expect(seenSignal).not.toBe(controller.signal);
    controller.abort();
    await expect(promise).rejects.toThrow(PaytmUpstreamError);
  });

  it("throws PaytmUpstreamError on non-200 status", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("boom", { status: 500 });

    await expect(
      fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, { fetchImpl }),
    ).rejects.toThrow(PaytmUpstreamError);
  });

  it("does not special-case 404", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("not found", { status: 404 });

    await expect(
      fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, { fetchImpl }),
    ).rejects.toThrow(PaytmUpstreamError);
  });

  it("throws PaytmUpstreamError on invalid JSON", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      });

    await expect(
      fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, { fetchImpl }),
    ).rejects.toThrow(PaytmUpstreamError);
  });

  it("throws PaytmUpstreamError when body is missing", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ foo: "bar" });

    await expect(
      fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, { fetchImpl }),
    ).rejects.toThrow(PaytmUpstreamError);
  });

  it("throws PaytmUpstreamError when body is not an object", async () => {
    const fetchImpl: typeof fetch = async () => jsonResponse({ body: null });

    await expect(
      fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, { fetchImpl }),
    ).rejects.toThrow(PaytmUpstreamError);
  });

  it("throws PaytmTrainNotFoundError when upstream reports an error", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({ error: true, status: { result: "failure" } });

    await expect(
      fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, { fetchImpl }),
    ).rejects.toThrow(PaytmTrainNotFoundError);
  });

  it("does not throw PaytmTrainNotFoundError on successful result", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse({
        error: true,
        status: { result: "success" },
        body: { stations: [], current_station: null },
      });

    const payload = await fetchPaytmTrainStatus(
      TRAIN_NUMBER,
      DEPARTURE_DATE,
      { fetchImpl },
    );

    expect(payload.stations).toEqual([]);
  });

  it("builds the expected URL, query params, and headers", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (
      input: string | URL,
      init?: RequestInit,
    ) => {
      capturedUrl = String(input);
      capturedInit = init;
      return jsonResponse(happyRaw);
    };

    await fetchPaytmTrainStatus(TRAIN_NUMBER, DEPARTURE_DATE, { fetchImpl });

    const url = new URL(capturedUrl as string);
    expect(url.origin + url.pathname).toBe(
      "https://travel.paytm.com/api/trains/v1/train/status",
    );
    expect(url.searchParams.get("train_number")).toBe(TRAIN_NUMBER);
    expect(url.searchParams.get("departure_date")).toBe(DEPARTURE_DATE);
    expect(url.searchParams.get("isH5")).toBe("true");
    expect(url.searchParams.get("client")).toBe("web");
    expect(url.searchParams.get("deviceIdentifier")).toBe(
      "Mozilla Firefox-150.0.0.0",
    );
    expect(capturedInit?.signal).toBeInstanceOf(AbortSignal);
    expect(capturedInit?.headers).toEqual({
      "User-Agent":
        "Mozilla/5.0 (compatible; TrainTracker/1.0) AppleWebKit/537.36",
      Accept: "application/json",
    });
  });
});

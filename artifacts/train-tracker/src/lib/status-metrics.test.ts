import { describe, expect, it } from "vitest";
import {
  computeDurationMinutes,
  computeProgressPercent,
  findCurrentStation,
  isProviderUnreachableError,
  isTrainNotFoundError,
  type StatusStationLike,
} from "./status-metrics";

function station(overrides: Partial<StatusStationLike>): StatusStationLike {
  return {
    station_code: "INDB",
    station_name: "Indore Jn",
    scheduled_arrival: null,
    scheduled_departure: null,
    actual_arrival: null,
    actual_departure: null,
    distance_from_source: null,
    is_current: false,
    day: 1,
    delay_minutes: null,
    platform: null,
    halt_minutes: null,
    has_departed: false,
    ...overrides,
  };
}

describe("findCurrentStation", () => {
  it("returns the station flagged is_current", () => {
    const stations = [
      station({ station_code: "A", is_current: false }),
      station({ station_code: "B", is_current: true }),
      station({ station_code: "C", is_current: false }),
    ];
    expect(findCurrentStation(stations)?.station_code).toBe("B");
  });

  it("returns null when no station is current", () => {
    expect(
      findCurrentStation([station({ is_current: false })]),
    ).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findCurrentStation([])).toBeNull();
  });
});

describe("computeProgressPercent", () => {
  it("computes a plain percentage", () => {
    expect(computeProgressPercent(50, 100)).toBe(50);
    expect(computeProgressPercent(250, 1000)).toBe(25);
  });

  it("clamps below 0 to 0", () => {
    expect(computeProgressPercent(-10, 100)).toBe(0);
  });

  it("clamps above 100 to 100", () => {
    expect(computeProgressPercent(120, 100)).toBe(100);
  });

  it("returns null when the current distance is null", () => {
    expect(computeProgressPercent(null, 100)).toBeNull();
  });

  it("returns null when the total distance is null", () => {
    expect(computeProgressPercent(50, null)).toBeNull();
  });

  it("returns null when the total distance is 0", () => {
    expect(computeProgressPercent(50, 0)).toBeNull();
  });
});

describe("computeDurationMinutes", () => {
  it("computes minutes between departure and arrival", () => {
    expect(
      computeDurationMinutes(
        { scheduled_departure: "09:00" },
        { scheduled_arrival: "14:30" },
      ),
    ).toBe(330);
  });

  it("rolls over midnight when arrival is before departure", () => {
    expect(
      computeDurationMinutes(
        { scheduled_departure: "23:50" },
        { scheduled_arrival: "00:20" },
      ),
    ).toBe(30);
  });

  it("returns null when the departure is missing", () => {
    expect(
      computeDurationMinutes(
        { scheduled_departure: null },
        { scheduled_arrival: "14:30" },
      ),
    ).toBeNull();
  });

  it("returns null when the arrival is missing", () => {
    expect(
      computeDurationMinutes(
        { scheduled_departure: "09:00" },
        { scheduled_arrival: null },
      ),
    ).toBeNull();
  });

  it("returns null when both times are missing", () => {
    expect(
      computeDurationMinutes(
        { scheduled_departure: null },
        { scheduled_arrival: null },
      ),
    ).toBeNull();
  });
});

const API_ERROR_404 = {
  name: "ApiError",
  status: 404,
  statusText: "Not Found",
  data: { error: "Train not found" },
  method: "GET",
  url: "/api/trains/status?train_number=22943&departure_date=20260801",
};

const API_ERROR_502 = {
  name: "ApiError",
  status: 502,
  statusText: "Bad Gateway",
  data: { error: "Upstream provider unreachable" },
  method: "GET",
  url: "/api/trains/status?train_number=22943&departure_date=20260801",
};

const NETWORK_ERROR = new TypeError("Failed to fetch");

describe("isTrainNotFoundError", () => {
  it("matches a 404 ApiError-shaped object", () => {
    expect(isTrainNotFoundError(API_ERROR_404)).toBe(true);
  });

  it("does not match 5xx or other statuses", () => {
    expect(isTrainNotFoundError(API_ERROR_502)).toBe(false);
    expect(isTrainNotFoundError({ status: 400 })).toBe(false);
  });

  it("does not match network errors or non-objects", () => {
    expect(isTrainNotFoundError(NETWORK_ERROR)).toBe(false);
    expect(isTrainNotFoundError(null)).toBe(false);
    expect(isTrainNotFoundError(undefined)).toBe(false);
    expect(isTrainNotFoundError("HTTP 404")).toBe(false);
  });
});

describe("isProviderUnreachableError", () => {
  it("matches 5xx statuses", () => {
    expect(isProviderUnreachableError(API_ERROR_502)).toBe(true);
    expect(isProviderUnreachableError({ status: 503 })).toBe(true);
    expect(isProviderUnreachableError({ status: 500 })).toBe(true);
  });

  it("does not match 4xx statuses", () => {
    expect(isProviderUnreachableError(API_ERROR_404)).toBe(false);
    expect(isProviderUnreachableError({ status: 400 })).toBe(false);
  });

  it("does not match network errors or malformed statuses", () => {
    expect(isProviderUnreachableError(NETWORK_ERROR)).toBe(false);
    expect(isProviderUnreachableError({ status: "502" })).toBe(false);
    expect(isProviderUnreachableError(null)).toBe(false);
  });
});

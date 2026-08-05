import { describe, expect, it } from "vitest";
import {
  computeLivePosition,
  computeTrackLayout,
  type TrackStationLike,
} from "./track-geometry";

const stations: TrackStationLike[] = [
  {
    station_code: "ADI",
    station_name: "Ahmedabad Junction",
    scheduled_departure: "22:05",
    actual_departure: "22:05",
    distance_from_source: 0,
    is_current: false,
    day: 1,
    has_departed: true,
  },
  {
    station_code: "BRC",
    station_name: "Vadodara Junction",
    scheduled_arrival: "23:30",
    scheduled_departure: "23:35",
    actual_arrival: "23:30",
    actual_departure: "23:40",
    distance_from_source: 100,
    is_current: true,
    day: 1,
    has_departed: true,
  },
  {
    station_code: "ST",
    station_name: "Surat",
    scheduled_arrival: "01:30",
    distance_from_source: 200,
    is_current: false,
    day: 2,
    has_departed: false,
  },
];

describe("computeTrackLayout", () => {
  it("places stations proportionally to distance from source", () => {
    const layout = computeTrackLayout(stations);
    expect(layout.positions).toHaveLength(3);
    expect(layout.positions[0]).toBe(0);
    expect(layout.positions[1]).toBe(50);
    expect(layout.positions[2]).toBe(100);
  });

  it("falls back to even spacing when distances are missing", () => {
    const missing = stations.map(({ distance_from_source: _distance, ...station }) => ({
      ...station,
      distance_from_source: null,
    }));
    const layout = computeTrackLayout(missing);
    expect(layout.positions).toEqual([0, 50, 100]);
  });

  it("falls back to even spacing when all distances are equal", () => {
    const flat = stations.map((station) => ({ ...station, distance_from_source: 5 }));
    const layout = computeTrackLayout(flat);
    expect(layout.positions).toEqual([0, 50, 100]);
  });

  it("handles a single station", () => {
    expect(computeTrackLayout([stations[0]]).positions).toEqual([0]);
  });

  it("handles an empty list", () => {
    expect(computeTrackLayout([]).positions).toEqual([]);
  });
});

describe("computeLivePosition", () => {
  const now = new Date(2026, 7, 5, 23, 55);

  it("interpolates the train between the current and next station", () => {
    const layout = computeTrackLayout(stations);
    const live = computeLivePosition(stations, layout.positions, now);
    expect(live.currentIndex).toBe(1);
    expect(live.nextIndex).toBe(2);
    expect(live.moving).toBe(true);
    expect(live.percent).toBeGreaterThan(50);
    expect(live.percent).toBeLessThan(100);
    expect(live.fraction).toBeGreaterThan(0);
    expect(live.fraction).toBeLessThan(1);
  });

  it("keeps the train parked at the current station until it has departed", () => {
    const waiting = stations.map((station, index) =>
      index === 1 ? { ...station, has_departed: false } : station,
    );
    const layout = computeTrackLayout(waiting);
    const live = computeLivePosition(waiting, layout.positions, now);
    expect(live.percent).toBe(50);
    expect(live.moving).toBe(false);
    expect(live.fraction).toBe(0);
  });

  it("clamps to the current station when now is before departure", () => {
    const early = new Date(2026, 7, 5, 23, 0);
    const layout = computeTrackLayout(stations);
    const live = computeLivePosition(stations, layout.positions, early);
    expect(live.percent).toBe(50);
    expect(live.moving).toBe(false);
  });

  it("clamps to the next station once the arrival window has passed", () => {
    const late = new Date(2026, 7, 6, 1, 50);
    const layout = computeTrackLayout(stations);
    const live = computeLivePosition(stations, layout.positions, late);
    expect(live.percent).toBe(100);
    expect(live.moving).toBe(false);
  });

  it("sits at the destination when the current station is the last one", () => {
    const arrived = stations.map((station) =>
      station.station_code === "ST" ? { ...station, is_current: true, has_departed: false } : { ...station, is_current: false },
    );
    const layout = computeTrackLayout(arrived);
    const live = computeLivePosition(arrived, layout.positions, now);
    expect(live.nextIndex).toBeNull();
    expect(live.percent).toBe(100);
    expect(live.moving).toBe(false);
    expect(live.fraction).toBe(0);
  });

  it("falls back to the last departed station when none is flagged current", () => {
    const noFlag = stations.map((station) => ({ ...station, is_current: false }));
    const layout = computeTrackLayout(noFlag);
    const live = computeLivePosition(noFlag, layout.positions, now);
    expect(live.currentIndex).toBe(1);
    expect(live.moving).toBe(true);
  });

  it("returns null for an empty route", () => {
    const live = computeLivePosition([], [], now);
    expect(live.percent).toBeNull();
    expect(live.moving).toBe(false);
  });

  it("parks at the current node when timings are missing", () => {
    const untimed = stations.map((station) => ({
      ...station,
      scheduled_departure: null,
      actual_departure: null,
      scheduled_arrival: null,
      actual_arrival: null,
    }));
    const layout = computeTrackLayout(untimed);
    const live = computeLivePosition(untimed, layout.positions, now);
    expect(live.percent).toBe(50);
    expect(live.moving).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { pointOnCubic, trimCubic } from "./track-layout";
import {
  computeTrackLayout2D,
  LABEL_FONT_SIZE,
  VIEWBOX_WIDTH,
  type CubicSegment,
  type TrackStationLike,
} from "./track-layout";

function station(code: string, distance: number): TrackStationLike {
  return {
    station_code: code,
    station_name: code,
    scheduled_departure: null,
    distance_from_source: distance,
    is_current: false,
    day: 1,
    has_departed: false,
  };
}

function many(count: number): TrackStationLike[] {
  return Array.from({ length: count }, (_, index) => station(`S${index}`, index * 10));
}

describe("computeTrackLayout2D", () => {
  it("produces a point per station with finite coordinates", () => {
    const stations = many(6);
    const layout = computeTrackLayout2D(stations);
    expect(layout.stations).toHaveLength(6);
    for (const entry of layout.stations) {
      expect(Number.isFinite(entry.point.x)).toBe(true);
      expect(Number.isFinite(entry.point.y)).toBe(true);
      expect(Number.isFinite(entry.angle)).toBe(true);
    }
    layout.stations.forEach((entry, index) => {
      expect(entry.side).toBe(index % 2 === 0 ? -1 : 1);
    });
  });

  it("builds one cubic segment per hop and a matching path", () => {
    const stations = many(4);
    const layout = computeTrackLayout2D(stations);
    expect(layout.segments).toHaveLength(3);
    expect(layout.path).toMatch(/^M /);
    expect(layout.path.split("C ").length - 1).toBe(3);
    expect(layout.pathLength).toBeGreaterThan(0);
  });

  it("keeps station spacing monotonic along the route when km grow", () => {
    const stations = many(12);
    const layout = computeTrackLayout2D(stations);
    const arcs: number[] = [];
    let run = 0;
    for (const segment of layout.segments) run += segment.length, arcs.push(run);
    expect(arcs).toHaveLength(11);
    for (let i = 1; i < arcs.length; i++) {
      expect(arcs[i]).toBeGreaterThan(arcs[i - 1]);
    }
  });

  it("wraps around a U-turn loop without leaving the viewport", () => {
    const layout = computeTrackLayout2D(many(30));
    expect(layout.height).toBeGreaterThan(VIEWBOX_WIDTH * 0.5);
    for (const entry of layout.stations) {
      expect(entry.point.x).toBeGreaterThanOrEqual(0);
      expect(entry.point.x).toBeLessThanOrEqual(VIEWBOX_WIDTH);
      expect(entry.point.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns an empty layout for no stations", () => {
    const layout = computeTrackLayout2D([]);
    expect(layout.stations).toEqual([]);
    expect(layout.segments).toEqual([]);
    expect(layout.path).toBe("");
    expect(layout.pathLength).toBe(0);
  });

  it("centers a single station", () => {
    const layout = computeTrackLayout2D([station("ONLY", 0)]);
    expect(layout.stations).toHaveLength(1);
    expect(layout.segments).toEqual([]);
    expect(layout.stations[0].point.x).toBe(VIEWBOX_WIDTH / 2);
    expect(layout.labelMaxWidth).toEqual([120]);
  });

  it("caps every label so same-side neighbours never overlap", () => {
    const layout = computeTrackLayout2D(many(14));
    for (let i = 0; i < layout.stations.length; i++) {
      expect(layout.labelMaxWidth[i]).toBeGreaterThan(0);
      expect(layout.labelMaxWidth[i]).toBeLessThanOrEqual(120);
      const side = layout.stations[i].side;
      for (const [j, other] of layout.stations.entries()) {
        if (j === i || other.side !== side) continue;
        const gap = Math.abs(other.label.x - layout.stations[i].label.x);
        expect(layout.labelMaxWidth[i]).toBeLessThanOrEqual(gap);
      }
    }
  });

  it("keeps rendered labels from overlapping even for long station names", () => {
    const longStations = many(14).map((entry, index) => ({
      ...entry,
      station_name: `International Junction Number ${index}`,
    }));
    const layout = computeTrackLayout2D(longStations);
    const CHAR_FACTOR = 0.6;
    const widths = layout.stations.map((_, index) => {
      const maxWidth = layout.labelMaxWidth[index];
      const nameWidth =
        longStations[index].station_name.length * CHAR_FACTOR * LABEL_FONT_SIZE;
      const text =
        nameWidth <= maxWidth ? longStations[index].station_name : longStations[index].station_code;
      return Math.min(maxWidth, text.length * CHAR_FACTOR * LABEL_FONT_SIZE);
    });
    for (let i = 0; i < layout.stations.length; i++) {
      for (let k = 0; k < layout.stations.length; k++) {
        if (i >= k || layout.stations[i].side !== layout.stations[k].side) continue;
        const gap = Math.abs(
          layout.stations[k].label.x - layout.stations[i].label.x,
        );
        expect((widths[i] + widths[k]) / 2).toBeLessThanOrEqual(gap + 0.001);
      }
    }
  });
});

describe("pointOnCubic / trimCubic", () => {
  const seg: CubicSegment = {
    p0: { x: 0, y: 0 },
    p1: { x: 100, y: 0 },
    c1: { x: 30, y: 50 },
    c2: { x: 70, y: 50 },
    length: 0,
  };

  it("evaluates endpoints exactly", () => {
    expect(pointOnCubic(seg, 0)).toEqual({ x: 0, y: 0 });
    expect(pointOnCubic(seg, 1)).toEqual({ x: 100, y: 0 });
  });

  it("trims a cubic so it stays inside the original bounds", () => {
    const t = 0.4;
    const trimmed = trimCubic(seg, t);
    expect(trimmed.p0).toEqual(seg.p0);
    expect(pointOnCubic(trimmed, 1).x).toBeCloseTo(pointOnCubic(seg, t).x, 6);
    expect(pointOnCubic(trimmed, 1).y).toBeCloseTo(pointOnCubic(seg, t).y, 6);
    const end = pointOnCubic(trimmed, 1);
    expect(end.x).toBeGreaterThanOrEqual(seg.p0.x);
    expect(end.x).toBeLessThanOrEqual(seg.p1.x);
  });
});

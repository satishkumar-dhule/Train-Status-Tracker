import { computeTrackLayout } from "./track-geometry";
import type { TrackStationLike } from "./track-geometry";

export interface Point {
  x: number;
  y: number;
}

export interface CubicSegment {
  p0: Point;
  p1: Point;
  c1: Point;
  c2: Point;
  length: number;
}

export interface StationLayout {
  point: Point;
  angle: number;
  label: Point;
  side: -1 | 1;
}

export interface TrackLayout2D {
  width: number;
  height: number;
  path: string;
  segments: CubicSegment[];
  pathLength: number;
  stations: StationLayout[];
  positions: number[];
  labelMaxWidth: number[];
}

export const VIEWBOX_WIDTH = 800;
const TOP_PAD = 90;
const BOTTOM_PAD = 70;
const ROW_HEIGHT = 150;
const SIDE_PAD = 70;
const DENSITY = 3;
const LABEL_OFFSET = 36;
export const LABEL_FONT_SIZE = 11;
const MAX_LABEL_WIDTH = 120;
const MIN_LABEL_WIDTH = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function computeRows(count: number): number {
  return clamp(Math.ceil(count / 10), 1, 4);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function buildPolyline(width: number, height: number, rows: number): Point[] {
  const left = SIDE_PAD;
  const right = width - SIDE_PAD;
  const points: Point[] = [];
  const amplitude = rows === 1 ? 60 : rows === 2 ? 34 : 24;
  const periods = rows === 1 ? 3 : 2;

  for (let row = 0; row < rows; row++) {
    const yBase = TOP_PAD + ROW_HEIGHT * row + ROW_HEIGHT / 2;
    const forward = row % 2 === 0;
    const x0 = forward ? left : right;
    const x1 = forward ? right : left;
    const span = Math.abs(x1 - x0);
    const steps = Math.ceil(span / DENSITY);

    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      const x = lerp(x0, x1, t);
      const wave = Math.sin(t * Math.PI * periods + row * Math.PI) * amplitude;
      points.push({ x, y: yBase + wave });
    }

    if (row < rows - 1) {
      const cx = forward ? right : left;
      const bulge = forward ? -1 : 1;
      const yFrom = yBase;
      const yTo = yBase + ROW_HEIGHT;
      const mid = (yFrom + yTo) / 2;
      const radius = ROW_HEIGHT / 2;
      const loopSteps = Math.max(6, Math.ceil((Math.PI * radius) / DENSITY));
      for (let step = 1; step <= loopSteps; step++) {
        const theta = (Math.PI * step) / loopSteps;
        const x = cx + bulge * radius * Math.sin(theta);
        const y = mid - radius * Math.cos(theta);
        points.push({ x, y });
      }
    }
  }

  return points;
}

function cumulativeLengths(points: readonly Point[]): number[] {
  const lengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
  }
  return lengths;
}

function pointAtArc(
  points: readonly Point[],
  lengths: readonly number[],
  arc: number,
): Point {
  if (arc <= 0) return points[0];
  const total = lengths[lengths.length - 1];
  if (arc >= total) return points[points.length - 1];
  for (let i = 1; i < points.length; i++) {
    if (arc <= lengths[i]) {
      const span = lengths[i] - lengths[i - 1];
      const t = span === 0 ? 0 : (arc - lengths[i - 1]) / span;
      return {
        x: lerp(points[i - 1].x, points[i].x, t),
        y: lerp(points[i - 1].y, points[i].y, t),
      };
    }
  }
  return points[points.length - 1];
}

function cubicLength(seg: CubicSegment): number {
  const samples = 16;
  let length = 0;
  let prev = seg.p0;
  for (let i = 1; i <= samples; i++) {
    const p = pointOnCubic(seg, i / samples);
    length += distance(prev, p);
    prev = p;
  }
  return length;
}

export function pointOnCubic(seg: CubicSegment, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * seg.p0.x + b * seg.c1.x + c * seg.c2.x + d * seg.p1.x,
    y: a * seg.p0.y + b * seg.c1.y + c * seg.c2.y + d * seg.p1.y,
  };
}

export function trimCubic(seg: CubicSegment, t: number): CubicSegment {
  const p01 = { x: lerp(seg.p0.x, seg.c1.x, t), y: lerp(seg.p0.y, seg.c1.y, t) };
  const p12 = { x: lerp(seg.c1.x, seg.c2.x, t), y: lerp(seg.c1.y, seg.c2.y, t) };
  const p23 = { x: lerp(seg.c2.x, seg.p1.x, t), y: lerp(seg.c2.y, seg.p1.y, t) };
  const p012 = { x: lerp(p01.x, p12.x, t), y: lerp(p01.y, p12.y, t) };
  const p123 = { x: lerp(p12.x, p23.x, t), y: lerp(p12.y, p23.y, t) };
  const p0123 = { x: lerp(p012.x, p123.x, t), y: lerp(p012.y, p123.y, t) };
  return {
    p0: { ...seg.p0 },
    c1: p01,
    c2: p012,
    p1: p0123,
    length: 0,
  };
}

export function cubicCommand(seg: CubicSegment): string {
  return `C ${round(seg.c1.x)} ${round(seg.c1.y)} ${round(seg.c2.x)} ${round(
    seg.c2.y,
  )} ${round(seg.p1.x)} ${round(seg.p1.y)}`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeTrackLayout2D(
  stations: readonly TrackStationLike[],
): TrackLayout2D {
  const width = VIEWBOX_WIDTH;
  const count = stations.length;

  if (count === 0) {
    return {
      width,
      height: TOP_PAD + BOTTOM_PAD,
      path: "",
      segments: [],
      pathLength: 0,
      stations: [],
      positions: [],
      labelMaxWidth: [],
    };
  }

  const rows = computeRows(count);
  const height = TOP_PAD + rows * ROW_HEIGHT + BOTTOM_PAD;

  if (count === 1) {
    const point = { x: width / 2, y: TOP_PAD + ROW_HEIGHT / 2 };
    return {
      width,
      height,
      path: `M ${point.x} ${point.y}`,
      segments: [],
      pathLength: 0,
      stations: [
        {
          point,
          angle: 0,
          label: { x: point.x, y: point.y - LABEL_OFFSET },
          side: -1,
        },
      ],
      positions: [0],
      labelMaxWidth: [MAX_LABEL_WIDTH],
    };
  }

  const polyline = buildPolyline(width, height, rows);
  const lengths = cumulativeLengths(polyline);
  const total = lengths[lengths.length - 1];
  const positions = computeTrackLayout(stations).positions;
  const nodes = positions.map((position) =>
    pointAtArc(polyline, lengths, total * (position / 100)),
  );

  const segments: CubicSegment[] = [];
  for (let i = 0; i < count - 1; i++) {
    const p0 = nodes[Math.max(0, i - 1)];
    const p1 = nodes[i];
    const p2 = nodes[i + 1];
    const p3 = nodes[Math.min(count - 1, i + 2)];
    const seg: CubicSegment = {
      p0: { ...p1 },
      p1: { ...p2 },
      c1: {
        x: p1.x + (p2.x - p0.x) / 6,
        y: p1.y + (p2.y - p0.y) / 6,
      },
      c2: {
        x: p2.x - (p3.x - p1.x) / 6,
        y: p2.y - (p3.y - p1.y) / 6,
      },
      length: 0,
    };
    seg.length = cubicLength(seg);
    segments.push(seg);
  }

  let path = `M ${round(nodes[0].x)} ${round(nodes[0].y)}`;
  for (const seg of segments) path += cubicCommand(seg);
  const pathLength = segments.reduce((sum, seg) => sum + seg.length, 0);

  const stationLayouts: StationLayout[] = nodes.map((point, index) => {
    const before = nodes[Math.max(0, index - 1)];
    const after = nodes[Math.min(count - 1, index + 1)];
    const angle = Math.atan2(after.y - before.y, after.x - before.x);
    const side: -1 | 1 = index % 2 === 0 ? -1 : 1;
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    return {
      point,
      angle,
      side,
      label: {
        x: point.x + perpX * side * LABEL_OFFSET,
        y: point.y + perpY * side * LABEL_OFFSET,
      },
    };
  });

  const labelMaxWidth = stationLayouts.map((layout, index) => {
    let raw = MAX_LABEL_WIDTH;
    for (let j = 0; j < stationLayouts.length; j++) {
      if (j === index || stationLayouts[j].side !== layout.side) continue;
      raw = Math.min(
        raw,
        Math.abs(stationLayouts[j].label.x - layout.label.x),
      );
    }
    return Math.max(MIN_LABEL_WIDTH, Math.min(raw, MAX_LABEL_WIDTH));
  });

  return {
    width,
    height,
    path,
    segments,
    pathLength,
    stations: stationLayouts,
    positions,
    labelMaxWidth,
  };
}

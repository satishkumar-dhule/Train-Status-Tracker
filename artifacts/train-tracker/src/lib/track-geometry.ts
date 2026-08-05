import { toMinutes } from "@workspace/trains-data";

export interface TrackStationLike {
  station_code: string;
  station_name: string;
  scheduled_arrival?: string | null;
  scheduled_departure?: string | null;
  actual_arrival?: string | null;
  actual_departure?: string | null;
  distance_from_source?: number | null;
  is_current: boolean;
  day: number;
  has_departed: boolean;
}

export interface TrackLayout {
  positions: number[];
}

export interface LivePositionResult {
  percent: number | null;
  currentIndex: number | null;
  nextIndex: number | null;
  moving: boolean;
  fraction: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeTrackLayout(
  stations: readonly TrackStationLike[],
): TrackLayout {
  const count = stations.length;
  if (count === 0) return { positions: [] };
  if (count === 1) return { positions: [0] };

  const distances = stations.map((station) => station.distance_from_source);
  const first = distances[0];
  const last = distances[count - 1];
  const proportional =
    first !== null &&
    first !== undefined &&
    last !== null &&
    last !== undefined &&
    Number.isFinite(first) &&
    Number.isFinite(last) &&
    last - first > 0 &&
    distances.every(
      (distance) =>
        distance !== null &&
        distance !== undefined &&
        Number.isFinite(distance),
    );

  let positions: number[];
  if (proportional) {
    const min = first as number;
    const max = last as number;
    positions = distances.map((distance) =>
      clamp((((distance as number) - min) / (max - min)) * 100, 0, 100),
    );
  } else {
    positions = stations.map((_, index) => (index / (count - 1)) * 100);
  }

  return { positions };
}

function dayOffsetMinutes(
  time: string | null | undefined,
  day: number,
): number | null {
  const minutes = toMinutes(time);
  if (minutes === null) return null;
  return minutes + (day - 1) * 1440;
}

function findCurrentIndex(stations: readonly TrackStationLike[]): number {
  const current = stations.findIndex((station) => station.is_current);
  if (current !== -1) return current;
  for (let index = stations.length - 1; index >= 0; index--) {
    if (stations[index].has_departed) return index;
  }
  return 0;
}

export function computeLivePosition(
  stations: readonly TrackStationLike[],
  positions: readonly number[],
  now?: Date,
): LivePositionResult {
  if (stations.length === 0) {
    return {
      percent: null,
      currentIndex: null,
      nextIndex: null,
      moving: false,
      fraction: 0,
    };
  }

  const clock = now ?? new Date();
  const nowMinutes = clock.getHours() * 60 + clock.getMinutes();
  const currentIndex = findCurrentIndex(stations);
  const nextIndex = currentIndex < stations.length - 1 ? currentIndex + 1 : null;

  if (nextIndex === null) {
    return {
      percent: positions[currentIndex] ?? 0,
      currentIndex,
      nextIndex: null,
      moving: false,
      fraction: 0,
    };
  }

  const current = stations[currentIndex];
  const next = stations[nextIndex];
  let fraction = 0;

  if (current.has_departed) {
    const depart = dayOffsetMinutes(
      current.actual_departure ?? current.scheduled_departure,
      current.day,
    );
    const arrive = dayOffsetMinutes(
      next.actual_arrival ?? next.scheduled_arrival,
      next.day,
    );
    if (depart !== null && arrive !== null && arrive > depart) {
      const center = (depart + arrive) / 2;
      let alignedNow = nowMinutes;
      while (alignedNow < center - 720) alignedNow += 1440;
      while (alignedNow > center + 720) alignedNow -= 1440;
      fraction = clamp((alignedNow - depart) / (arrive - depart), 0, 1);
    }
  }

  const currentPosition = positions[currentIndex] ?? 0;
  const nextPosition = positions[nextIndex] ?? 0;
  const percent = currentPosition + (nextPosition - currentPosition) * fraction;

  return {
    percent,
    currentIndex,
    nextIndex,
    moving: fraction > 0 && fraction < 1,
    fraction,
  };
}

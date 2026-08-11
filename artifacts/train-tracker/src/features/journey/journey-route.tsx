import type { StatusStationLike } from "@/lib/status-metrics";
import { cn } from "@/lib/utils";

export interface JourneyRouteProps {
  stations: StatusStationLike[];
  currentIndex: number | null;
  nextIndex: number | null;
}

type LegState = "passed" | "current" | "ahead";

function legState(i: number, currentIndex: number | null): LegState {
  if (currentIndex === null) return "ahead";
  if (i < currentIndex) return "passed";
  if (i === currentIndex) return "current";
  return "ahead";
}

export function JourneyRoute({
  stations,
  currentIndex,
  nextIndex,
}: JourneyRouteProps) {
  const legCount = Math.max(0, stations.length - 1);

  let currentName: string | null = null;
  if (
    currentIndex !== null &&
    currentIndex >= 0 &&
    currentIndex < stations.length
  ) {
    currentName = stations[currentIndex].station_name;
  }

  let nextStopName: string | null = null;
  if (nextIndex !== null && nextIndex >= 0 && nextIndex < stations.length) {
    nextStopName = stations[nextIndex].station_name;
  }

  const originName = stations[0]?.station_name ?? null;
  const destinationName =
    stations.length > 0 ? stations[stations.length - 1].station_name : null;

  const label = nextStopName
    ? `Journey progress, next stop ${nextStopName}`
    : "Journey progress";

  return (
    <div
      data-testid="journey-route"
      aria-label={label}
      className="rounded-xl border border-card-border bg-card p-3"
    >
      {legCount > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 font-mono text-xs text-muted-foreground">
            <span className="min-w-0 truncate">{originName}</span>
            {currentName && (
              <span className="min-w-0 truncate font-semibold text-foreground">
                {currentName}
              </span>
            )}
            <span className="min-w-0 truncate">{destinationName}</span>
          </div>
          <div
            data-testid="progress-bar"
            className="relative flex items-center py-1"
          >
            {Array.from({ length: legCount }, (_, i) => {
              const state = legState(i, currentIndex);
              const code = stations[i + 1].station_code;
              return (
                <div
                  key={code}
                  data-testid={`route-segment-${code}`}
                  className="relative flex-1"
                >
                  <div
                    className={cn(
                      "h-1.5 w-full rounded-full",
                      state === "passed" ? "bg-success" : "bg-muted",
                    )}
                  />
                  {state === "current" && (
                    <span
                      data-testid="route-marker"
                      className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-success motion-reduce:animate-none"
                    />
                  )}
                </div>
              );
            })}
            {stations.map((station, i) => (
              <span
                key={station.station_code}
                aria-hidden="true"
                className="absolute top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border"
                style={{ left: `${(i / legCount) * 100}%` }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

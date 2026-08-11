import { Button, Card, Label, Pill } from "@/components/primitives";
import { formatDelayPhrase } from "@/lib/format";
import { computeStationDelay } from "@/lib/status-metrics";
import type { StatusStationLike } from "@/lib/status-metrics";
import { cn } from "@/lib/utils";

export interface StationTimelineProps {
  stations: StatusStationLike[];
  maxVisible?: number;
  showAll: boolean;
  onToggleShowAll: () => void;
}

type DelayVariant = "on-time" | "late" | "cancelled" | "neutral";

const CURRENT_WINDOW = 2;

function delayVariant(delayMinutes: number): DelayVariant {
  if (delayMinutes > 0) return "late";
  if (delayMinutes < 0) return "neutral";
  return "on-time";
}

function visibleStations(
  stations: StatusStationLike[],
  maxVisible: number,
  showAll: boolean,
): StatusStationLike[] {
  if (showAll || stations.length <= maxVisible) return stations;
  const currentIndex = stations.findIndex((station) => station.is_current);
  if (currentIndex === -1) return stations.slice(0, maxVisible);
  const start = Math.max(0, currentIndex - CURRENT_WINDOW);
  const end = Math.min(stations.length, currentIndex + CURRENT_WINDOW + 1);
  return stations.slice(start, end);
}

export function StationTimeline({
  stations,
  maxVisible = 7,
  showAll,
  onToggleShowAll,
}: StationTimelineProps) {
  const visible = visibleStations(stations, maxVisible, showAll);
  const hasDisclosure = stations.length > maxVisible;

  return (
    <Card
      data-testid="station-timeline"
      padding="none"
      className="py-2"
    >
      <div className="flex items-stretch gap-3 px-4 py-2">
        <div className="w-0.5 shrink-0" />
        <Label tone="muted">Scheduled · Actual</Label>
      </div>

      {visible.map((station) => {
        const isPassed = station.has_departed;
        const isCurrent = station.is_current;

        const timeSch =
          station.scheduled_arrival || station.scheduled_departure || "--:--";
        const timeAct =
          station.actual_arrival || station.actual_departure || null;
        const timeChanged = timeAct != null && timeAct !== timeSch;
        const delayMinutes = computeStationDelay(station);
        const halt = station.halt_minutes;

        return (
          <div
            key={station.station_code}
            className={cn(
              "flex items-stretch gap-3 px-4 py-2.5 min-h-[44px]",
              isCurrent && "bg-muted/60",
              isPassed && !isCurrent && "text-muted-foreground/70",
            )}
            data-testid={`row-station-${station.station_code}`}
          >
            <div className="relative w-0.5 shrink-0 self-stretch bg-border">
              <div
                className={cn(
                  "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  isCurrent
                    ? "h-3 w-3 bg-foreground"
                    : isPassed
                      ? "h-2.5 w-2.5 bg-muted-foreground/50"
                      : "h-2.5 w-2.5 border-2 border-muted-foreground/40 bg-transparent",
                )}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "truncate text-[15px] font-medium",
                    isCurrent && "font-semibold text-foreground",
                  )}
                >
                  {station.station_name}
                  <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
                    {station.station_code}
                  </span>
                </span>
                {delayMinutes != null && (
                  <Pill
                    variant={delayVariant(delayMinutes)}
                    size="sm"
                    announce={isCurrent}
                    className="normal-case"
                  >
                    {formatDelayPhrase(delayMinutes)}
                  </Pill>
                )}
              </div>

              <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span className="tabular-nums">{timeSch}</span>
                {timeChanged && (
                  <>
                    <span className="tabular-nums">{timeAct}</span>
                    <span className="text-[10px] uppercase tracking-widest">
                      ACT
                    </span>
                  </>
                )}
                {station.day > 1 && (
                  <span className="text-[10px] uppercase tracking-widest">
                    Day {station.day}
                  </span>
                )}
                {station.platform != null && station.platform !== "" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest">
                    PF {station.platform}
                  </span>
                )}
                {halt != null && halt > 0 && (
                  <span className="text-[10px] uppercase tracking-widest">
                    Halt {halt} min
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {hasDisclosure && (
        <div className="px-4 pb-1 pt-1">
          <Button
            variant="ghost"
            size="sm"
            data-testid="all-stations-toggle"
            aria-expanded={showAll}
            onClick={onToggleShowAll}
          >
            {showAll ? "Show fewer" : `Show all ${stations.length} stations`}
          </Button>
        </div>
      )}
    </Card>
  );
}

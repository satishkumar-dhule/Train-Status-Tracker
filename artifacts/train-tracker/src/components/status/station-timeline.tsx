import type { StationStatus } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";
import { computeStationDelay } from "@/lib/status-metrics";
import { useI18n } from "@/lib/i18n";
import { DelayBadge } from "./delay-badge";

export function StationTimeline({ stations }: { stations: StationStatus[] }) {
  const { t } = useI18n();

  return (
    <div
      className="bg-card border border-card-border rounded-2xl py-2"
      data-testid="station-timeline"
    >
      {stations.map((station) => {
        const isPassed = station.has_departed;
        const isCurrent = station.is_current;

        const timeSch = station.scheduled_arrival || station.scheduled_departure || "--:--";
        const timeAct = station.actual_arrival || station.actual_departure || null;
        const timeChanged = timeAct != null && timeAct !== timeSch;

        const delayMinutes = computeStationDelay(station);

        return (
          <div
            key={station.station_code}
            className={cn(
              "relative flex items-stretch gap-3 px-4 py-2.5 min-h-[44px]",
              isCurrent && "bg-brand-soft/50",
              isPassed && !isCurrent && "text-muted-foreground/60"
            )}
            data-testid={`row-station-${station.station_code}`}
          >
            {/* Left rail — vertical track with a status dot per row */}
            <div className="relative w-0.5 shrink-0 self-stretch">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 w-0.5",
                  isCurrent
                    ? "bg-brand"
                    : isPassed
                      ? "bg-muted-foreground/30"
                      : "bg-border"
                )}
              />
              <div
                className={cn(
                  "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full",
                  isCurrent
                    ? "h-3 w-3 bg-brand animate-pulse-fast ring-4 ring-brand/20"
                    : isPassed
                      ? "h-2.5 w-2.5 bg-muted-foreground/30"
                      : "h-2.5 w-2.5 border-2 border-muted-foreground/40 bg-transparent"
                )}
              />
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              {/* Line 1 — station name + right-side state */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "font-sans text-[15px] font-medium min-w-0 truncate",
                    isCurrent && "text-primary font-semibold"
                  )}
                >
                  {station.station_name}
                </span>
                <span className="shrink-0">
                  {delayMinutes != null ? (
                    <DelayBadge delayMinutes={delayMinutes} />
                  ) : isPassed ? (
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {timeAct ?? timeSch}
                    </span>
                  ) : null}
                </span>
              </div>

              {/* Line 2 — schedule time, actual time, day */}
              <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground mt-0.5">
                <span className="tabular-nums">{timeSch}</span>
                {timeChanged && (
                  <>
                    <span className="tabular-nums">{timeAct}</span>
                    <span className="text-[10px] uppercase tracking-widest">ACT</span>
                  </>
                )}
                {station.day > 1 && (
                  <span className="text-[10px] uppercase tracking-widest">
                    {t("meta.day", { n: station.day })}
                  </span>
                )}
                {station.platform != null && station.platform !== "" && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                    {t("meta.platform", { n: station.platform })}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

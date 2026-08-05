import type { StationStatus } from "@workspace/api-client-react";
import { Badge } from "@/components/ui";
import { CalendarDays, Map, Route, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { DelayBadge } from "./delay-badge";

export function StationTimeline({ stations }: { stations: StationStatus[] }) {
  const { t } = useI18n();

  return (
    <div className="space-y-0 relative font-mono" data-testid="station-timeline">
      {stations.map((station, index) => {
        const isPassed = station.has_departed;
        const isCurrent = station.is_current;
        const isUpcoming = !isPassed && !isCurrent;
        const isLast = index === stations.length - 1;

        const timeSch = station.scheduled_arrival || station.scheduled_departure || "--:--";
        const timeAct = station.actual_arrival || station.actual_departure || null;
        const timeChanged = timeAct != null && timeAct !== timeSch;

        const textColor = isCurrent
          ? "text-primary"
          : isPassed
            ? "text-muted-foreground"
            : "text-foreground";

        const bgNode = isCurrent
          ? "bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.45)] animate-pulse-fast border-none ring-4 ring-primary/20"
          : isPassed
            ? "bg-muted-foreground/30 border-none"
            : "bg-background border-2 border-muted-foreground";

        const delayMinutes =
          station.delay_minutes != null && station.delay_minutes > 0
            ? station.delay_minutes
            : station.delay_minutes === 0 && !isUpcoming
              ? 0
              : null;

        return (
          <div
            key={station.station_code}
            className={cn(
              "flex gap-4 md:gap-6 min-h-[4.5rem] relative group",
              isPassed && !isCurrent ? "opacity-60 hover:opacity-100 transition-opacity" : ""
            )}
            data-testid={`row-station-${station.station_code}`}
          >
            {/* Time Column */}
            <div className="w-14 md:w-16 shrink-0 text-end pt-0.5 flex flex-col gap-1">
              <span
                className={cn(
                  "text-xs md:text-sm font-bold leading-none tracking-wider",
                  isPassed ? "text-muted-foreground" : "text-foreground"
                )}
              >
                {timeSch}
              </span>
              {timeChanged && (
                <span className="text-xs md:text-sm text-warning font-bold leading-none tracking-wider">
                  {timeAct}
                </span>
              )}
              {timeChanged && (
                <span className="text-xs text-muted-foreground uppercase tracking-widest leading-none">
                  ACT
                </span>
              )}
            </div>

            {/* Node & Line Column */}
            <div className="relative shrink-0 w-4 flex justify-center">
              {!isLast && (
                <div
                  className={cn(
                    "absolute top-3 bottom-[-0.5rem] w-px z-0",
                    isPassed && !isCurrent ? "bg-muted-foreground/30" : "bg-border"
                  )}
                />
              )}
              <div className={cn("w-3 h-3 rounded-full z-10 relative mt-1 shrink-0", bgNode)} />
            </div>

            {/* Details Column */}
            <div className="flex-1 min-w-0 pb-5 group-last:pb-2">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
                <div className="min-w-0">
                  <div
                    className={cn(
                      "text-sm md:text-base font-bold uppercase tracking-wider flex items-center gap-2 flex-wrap",
                      textColor
                    )}
                  >
                    {station.station_name}
                    <span className="opacity-50 font-normal text-xs md:text-sm">
                      [{station.station_code}]
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-2 flex gap-x-4 gap-y-1 flex-wrap uppercase tracking-widest font-semibold">
                    <span className="flex items-center gap-1">
                      <Map className="w-3 h-3" /> {t("meta.platform", { n: station.platform || "-" })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Route className="w-3 h-3" />{" "}
                      {t("meta.kilometers", { n: station.distance_from_source ?? "-" })}
                    </span>
                    <span className="flex items-center gap-1">
                      <Timer className="w-3 h-3" />{" "}
                      {t("meta.halt", { n: station.halt_minutes ? station.halt_minutes : "-" })}
                    </span>
                    <span className={cn("flex items-center gap-1", station.day > 1 && "text-warning")}>
                      <CalendarDays className="w-3 h-3" />
                      {station.day > 1 ? (
                        <Badge
                          variant="outline"
                          className="text-xs h-5 px-2 border-warning text-warning bg-warning/5 tracking-widest"
                        >
                          {t("meta.day", { n: station.day })}
                        </Badge>
                      ) : (
                        t("meta.day", { n: station.day })
                      )}
                    </span>
                  </div>
                </div>

                <DelayBadge delayMinutes={delayMinutes} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { StationStatus } from "@workspace/api-client-react";
import { MapPin } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { computeLivePosition, computeTrackLayout } from "@/lib/track-geometry";
import { computeStationDelay } from "@/lib/status-metrics";
import { DelayBadge } from "./delay-badge";

const NOW_TICK_MS = 30_000;

export function TrackView({
  stations,
  now: nowProp,
  isLiveData = true,
}: {
  stations: StationStatus[];
  now?: Date;
  /** True when the underlying status payload is fresh enough to call live. */
  isLiveData?: boolean;
}) {
  const { t } = useI18n();
  const positions = useMemo(
    () => computeTrackLayout(stations).positions,
    [stations],
  );

  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    if (nowProp) return;
    const id = window.setInterval(() => setTick(new Date()), NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, [nowProp]);

  const now = nowProp ?? tick;
  const live = useMemo(
    () => computeLivePosition(stations, positions, now),
    [stations, positions, now],
  );

  if (stations.length === 0) return null;

  const first = stations[0];
  const last = stations[stations.length - 1];
  const currentStation = stations.find((station) => station.is_current) ?? null;
  const runCompleted =
    !currentStation &&
    stations.length > 0 &&
    stations.every((station) => station.has_departed);
  const trackMinWidth = Math.max(320, stations.length * 64);
  const trainPercent = live.percent ?? 0;
  const showLive = isLiveData && live.moving;

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="relative overflow-hidden rounded-2xl border border-card-border bg-card"
        data-testid="track-view"
      >
        <div className="flex items-center justify-between gap-3 px-4 md:px-5 pt-4 md:pt-5 pb-3">
          <div className="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-widest text-foreground min-w-0">
            <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate">{first.station_code}</span>
            <span className="text-border shrink-0">→</span>
            <span className="truncate">{last.station_code}</span>
          </div>
        </div>

        {currentStation && (
          <div
            className="bg-brand-soft/60 border-y border-card-border px-4 py-2 flex items-center justify-between gap-3"
            data-testid="track-current-strip"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-brand animate-pulse-fast shrink-0" />
              <span className="font-mono text-sm font-bold uppercase tracking-wider text-primary shrink-0">
                [{currentStation.station_code}]
              </span>
              <span className="font-sans text-sm text-foreground truncate">
                {currentStation.station_name}
              </span>
            </div>
            <DelayBadge delayMinutes={computeStationDelay(currentStation)} />
          </div>
        )}

        {runCompleted && (
          <div
            className="bg-brand-soft/60 border-y border-card-border px-4 py-2 flex items-center justify-between gap-3"
            data-testid="track-completed-strip"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full bg-success shrink-0" />
              <span className="font-mono text-sm font-bold uppercase text-primary shrink-0">
                [{last.station_code}]
              </span>
              <span className="font-sans text-sm truncate">
                {last.station_name}
              </span>
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground shrink-0">
                COMPLETED
              </span>
            </div>
            <DelayBadge delayMinutes={computeStationDelay(last)} />
          </div>
        )}

        <div className="relative overflow-x-auto">
          <div
            className="relative h-16 md:h-20 px-4 md:px-6"
            style={{ minWidth: trackMinWidth }}
          >
            <div
              className="absolute left-0 right-0 top-1/2 -translate-y-[13px] h-2 w-full bg-muted/80 rounded-full"
              data-testid="track-rail-top"
            />
            <div
              className="absolute left-0 right-0 top-1/2 -translate-y-[3px] h-2 w-full bg-muted/80 rounded-full"
              data-testid="track-rail-bottom"
            />

            <svg
              className="absolute left-0 right-0 top-1/2 -translate-y-1/2 w-full h-[3px] animate-track-flow motion-reduce:animate-none"
              data-testid="track-flow"
            >
              <line
                x1="0"
                y1="1.5"
                x2="100%"
                y2="1.5"
                className="stroke-muted-foreground/50"
                strokeWidth="3"
                strokeLinecap="round"
                strokeDasharray="4 20"
              />
            </svg>

            {stations.map((station, index) => {
              const isCurrent = station.is_current;
              const passed = station.has_departed && !isCurrent;
              const pct = positions[index] ?? 0;

              return (
                <div
                  key={station.station_code}
                  data-testid={`track-station-${station.station_code}`}
                  className="absolute top-1/2 -translate-x-1/2 flex flex-col items-center"
                  style={{ left: `${pct}%` }}
                >
                  <div
                    className={cn(
                      "h-3 w-3 rounded-full -translate-y-1/2",
                      isCurrent
                        ? "bg-brand ring-4 ring-brand/20 animate-pulse-fast"
                        : passed
                          ? "bg-muted-foreground/50"
                          : "border-2 border-muted-foreground/50 bg-card",
                    )}
                  />
                  <span
                    className={cn(
                      "mt-0.5 font-mono text-[10px] uppercase leading-none text-muted-foreground",
                      isCurrent && "text-primary font-bold",
                    )}
                    data-testid={`track-label-${station.station_code}`}
                  >
                    {station.station_code}
                  </span>
                </div>
              );
            })}

            <div
              role="img"
              aria-label={t("status.live")}
              data-testid="track-train"
              className="absolute top-1/2 -translate-y-1/2 h-6 px-2 rounded-full bg-brand text-brand-foreground font-mono text-xs font-bold shadow-md grid grid-flow-col auto-cols-max place-items-center gap-1 whitespace-nowrap z-10"
              style={{ left: `${trainPercent}%` }}
            >
              <span aria-hidden="true">●</span>
              {showLive && (
                <span className="text-[9px] uppercase tracking-widest">
                  {t("status.live")}
                </span>
              )}
            </div>

            {stations.map((station, index) => {
              const pct = positions[index] ?? 0;

              return (
                <Tooltip key={station.station_code}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={station.station_name}
                      style={{ left: `${pct}%` }}
                      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`track-station-hit-${station.station_code}`}
                    />
                  </TooltipTrigger>
                  <TooltipContent className="bg-card border border-card-border text-card-foreground shadow-lg">
                    <div className="space-y-1.5 font-mono max-w-[220px]">
                      <div className="font-bold uppercase tracking-wider text-foreground">
                        {station.station_name}{" "}
                        <span className="font-normal text-muted-foreground">
                          [{station.station_code}]
                        </span>
                      </div>
                      <div className="text-sm text-muted-foreground uppercase tracking-widest">
                        {station.scheduled_arrival ??
                          station.scheduled_departure ??
                          "--:--"}
                        {station.scheduled_arrival && station.scheduled_departure
                          ? ` → ${station.scheduled_departure}`
                          : ""}
                        {station.day > 1
                          ? ` · ${t("meta.day", { n: station.day })}`
                          : ""}
                      </div>
                      {(station.platform != null ||
                        station.distance_from_source != null) && (
                        <div className="text-sm text-muted-foreground uppercase tracking-widest flex gap-x-2 flex-wrap">
                          {station.platform != null &&
                            station.platform !== "" &&
                            t("meta.platform", { n: station.platform })}
                          {station.distance_from_source != null &&
                            t("meta.kilometers", {
                              n: station.distance_from_source,
                            })}
                        </div>
                      )}
                      <DelayBadge delayMinutes={computeStationDelay(station)} />
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

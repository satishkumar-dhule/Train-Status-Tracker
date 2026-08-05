import { useEffect, useMemo, useState } from "react";
import type { StationStatus } from "@workspace/api-client-react";
import { MapPin } from "lucide-react";
import { Badge } from "@/components/ui";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { computeLivePosition } from "@/lib/track-geometry";
import {
  computeTrackLayout2D,
  cubicCommand,
  pointOnCubic,
  trimCubic,
  LABEL_FONT_SIZE,
  type Point,
} from "@/lib/track-layout";
import { DelayBadge } from "./delay-badge";

const NOW_TICK_MS = 30_000;
const ENDPOINT_PAD = 14;
const CHAR_FACTOR = 0.6;

function delayFor(station: StationStatus): number | null {
  if (station.delay_minutes != null && station.delay_minutes > 0) {
    return station.delay_minutes;
  }
  if (station.delay_minutes === 0 && station.has_departed) return 0;
  return null;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildProgressPath(
  segments: ReturnType<typeof computeTrackLayout2D>["segments"],
  start: Point,
  currentIndex: number | null,
  fraction: number,
): string {
  const first = segments[0]?.p0 ?? start;
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 0; i < (currentIndex ?? 0) && i < segments.length; i++) {
    d += cubicCommand(segments[i]);
  }
  if (currentIndex != null && currentIndex < segments.length && fraction > 0) {
    const seg =
      fraction < 1 ? trimCubic(segments[currentIndex], fraction) : segments[currentIndex];
    d += cubicCommand(seg);
  }
  return d;
}

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
  const layout = useMemo(() => computeTrackLayout2D(stations), [stations]);
  const gradientId = useMemo(
    () => `track-progress-${Math.random().toString(36).slice(2)}`,
    [],
  );

  const [tick, setTick] = useState(() => new Date());
  useEffect(() => {
    if (nowProp) return;
    const id = window.setInterval(() => setTick(new Date()), NOW_TICK_MS);
    return () => window.clearInterval(id);
  }, [nowProp]);

  const now = nowProp ?? tick;
  const live = useMemo(
    () => computeLivePosition(stations, layout.positions, now),
    [stations, layout.positions, now],
  );

  const progressPath = useMemo(
    () =>
      buildProgressPath(
        layout.segments,
        layout.stations[0]?.point ?? { x: 0, y: 0 },
        live.currentIndex,
        live.fraction,
      ),
    [layout, live],
  );

  const trainPos: Point = useMemo(() => {
    const index = live.currentIndex;
    if (index == null) return layout.stations[0]?.point ?? { x: 0, y: 0 };
    const segment = layout.segments[index];
    if (!segment) {
      const node =
        layout.stations[Math.min(index, layout.stations.length - 1)]?.point;
      return node ?? { x: 0, y: 0 };
    }
    return pointOnCubic(segment, Math.min(1, Math.max(0, live.fraction)));
  }, [layout, live]);

  if (stations.length === 0) return null;

  const first = stations[0];
  const last = stations[stations.length - 1];
  const currentStation = stations.find((station) => station.is_current) ?? null;
  const toPercent = (value: number) => `${(value / layout.width) * 100}%`;

  return (
    <TooltipProvider delayDuration={0}>
      <div
        className="bg-card border border-card-border rounded-2xl p-4 md:p-5"
        data-testid="track-view"
      >
        <div className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-2 font-mono text-sm font-bold uppercase tracking-widest text-foreground min-w-0">
            <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate">{first.station_code}</span>
            <span className="text-border shrink-0">→</span>
            <span className="truncate">{last.station_code}</span>
          </div>
          {isLiveData && live.moving && (
            <Badge
              variant="outline"
              className="text-xs h-6 px-2 border-primary/40 text-primary bg-primary/5 tracking-widest shrink-0"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse-fast inline-block me-1" />
              {t("status.live")}
            </Badge>
          )}
        </div>

        {currentStation && (
          <div
            className="flex items-center gap-2 mb-4 -mt-1"
            data-testid="track-current-strip"
          >
            <span className="w-2 h-2 rounded-full bg-brand animate-pulse-fast shrink-0" />
            <span className="font-mono text-sm font-bold uppercase tracking-wider text-brand truncate">
              {currentStation.station_name}
            </span>
            <span className="font-mono text-sm uppercase tracking-widest text-muted-foreground shrink-0">
              [{currentStation.station_code}]
            </span>
            <span className="ms-auto shrink-0">
              <DelayBadge delayMinutes={delayFor(currentStation)} />
            </span>
          </div>
        )}

        <div
          className="relative w-full"
          style={{ aspectRatio: `${layout.width} / ${layout.height}` }}
        >
          <svg
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            className="absolute inset-0 h-full w-full overflow-visible"
            role="img"
            aria-label={t("view.track")}
          >
            <defs>
              <linearGradient
                id={gradientId}
                gradientUnits="userSpaceOnUse"
                x1={0}
                y1={0}
                x2={layout.width}
                y2={layout.height}
              >
                <stop offset="0%" stopColor="var(--brand)" />
                <stop offset="55%" stopColor="var(--brand-strong)" />
                <stop offset="100%" stopColor="var(--accent)" />
              </linearGradient>
            </defs>

            <path
              d={layout.path}
              className="fill-none stroke-muted-foreground/25"
              strokeWidth={12}
              strokeLinecap="round"
              strokeLinejoin="round"
              data-testid="track-path"
            />

            <path
              d={layout.path}
              className="fill-none stroke-primary-foreground/60 animate-track-flow motion-reduce:animate-none"
              strokeWidth={12}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="4 20"
              data-testid="track-flow"
            />

            <path
              d={progressPath}
              className="fill-none"
              stroke={`url(#${gradientId})`}
              strokeWidth={12}
              strokeLinecap="round"
              strokeLinejoin="round"
              data-testid="track-line-progress"
            />

            {layout.stations.map((entry, index) => {
              const station = stations[index];
              const isCurrent = station.is_current;
              const isEndpoint = index === 0 || index === stations.length - 1;
              const passed = station.has_departed && !isCurrent;
              const radius = isEndpoint ? 9 : isCurrent ? 9 : 7;

              return (
                <g
                  key={station.station_code}
                  data-testid={`track-station-${station.station_code}`}
                  transform={`translate(${round(entry.point.x)} ${round(
                    entry.point.y,
                  )})`}
                >
                  {isCurrent && (
                    <circle
                      r={ENDPOINT_PAD}
                      className="fill-brand/20 animate-pulse motion-reduce:animate-none"
                    />
                  )}
                  <circle
                    r={radius}
                    className={cn(
                      isCurrent
                        ? "fill-brand stroke-card"
                        : passed
                          ? "fill-muted-foreground/50 stroke-card"
                          : "fill-background stroke-muted-foreground",
                    )}
                    strokeWidth={isCurrent ? 3 : 2.5}
                  />
                  {isEndpoint && (
                    <circle
                      r={2.5}
                      className={cn(
                        isEndpoint && isCurrent
                          ? "fill-card"
                          : passed
                            ? "fill-card"
                            : "fill-muted-foreground",
                      )}
                    />
                  )}
                </g>
              );
            })}

            {layout.stations.map((entry, index) => {
              const station = stations[index];
              const isCurrent = station.is_current;
              const maxLabelWidth = layout.labelMaxWidth[index];
              const nameWidth =
                station.station_name.length * CHAR_FACTOR * LABEL_FONT_SIZE;
              const showName = nameWidth <= maxLabelWidth;
              const text = showName
                ? station.station_name
                : station.station_code;
              const textLength = Math.min(
                maxLabelWidth,
                text.length * CHAR_FACTOR * LABEL_FONT_SIZE,
              );

              return (
                <text
                  key={station.station_code}
                  x={entry.label.x}
                  y={entry.label.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={LABEL_FONT_SIZE}
                  textLength={Math.round(textLength)}
                  lengthAdjust="spacingAndGlyphs"
                  stroke="var(--color-card)"
                  strokeWidth={3}
                  paintOrder="stroke"
                  className={cn(
                    "uppercase font-bold",
                    isCurrent ? "fill-brand" : "fill-muted-foreground",
                  )}
                  data-testid={`track-label-${station.station_code}`}
                >
                  {text}
                </text>
              );
            })}

            <g
              transform={`translate(${round(trainPos.x)} ${round(trainPos.y)})`}
              data-testid="track-train"
              role="img"
              aria-label={t("status.live")}
            >
              <circle r={15} className="fill-brand/15 animate-pulse motion-reduce:animate-none" />
              <circle r={11} className="fill-card stroke-brand" strokeWidth={3.5} />
              <circle r={4.5} className="fill-brand" />
            </g>
          </svg>

          {layout.stations.map((entry, index) => {
            const station = stations[index];

            return (
              <Tooltip key={station.station_code}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={station.station_name}
                    style={{
                      left: toPercent(entry.point.x),
                      top: `${(entry.point.y / layout.height) * 100}%`,
                    }}
                    className="absolute -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    <DelayBadge delayMinutes={delayFor(station)} />
                  </div>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}

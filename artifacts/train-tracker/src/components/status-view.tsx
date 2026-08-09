import { RefreshCw } from "lucide-react";
import type { StationStatus } from "@workspace/api-client-react";
import { formatDuration } from "@workspace/trains-data";
import type { TrainStatusResult } from "../hooks/use-train-status";
import {
  computeDurationMinutes,
  computeProgressPercent,
  computeStationDelay,
  findCurrentStation,
  findNextStation,
} from "../lib/status-metrics";
import { cn } from "../lib/utils";
import { DelayBadge } from "./delay-badge";
import { StatusSkeleton } from "./status-skeleton";

const ERROR_MESSAGES: Record<
  NonNullable<TrainStatusResult["errorType"]>,
  string
> = {
  "not-found": "Train not found or not scheduled to run on this date.",
  provider: "The train data provider is unreachable. Please try again.",
  network: "Could not reach the tracking service. Check your connection and try again.",
};

function Stat({
  label,
  value,
  sub,
  hero = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  hero?: boolean;
}) {
  if (hero) {
    return (
      <div className="relative col-span-2 overflow-hidden rounded-xl bg-primary p-3 min-w-0 md:col-span-1">
        <div className="text-[10px] uppercase tracking-widest text-primary-foreground/70 font-mono">
          {label}
        </div>
        <div className="mt-1 font-semibold text-lg text-primary-foreground truncate">
          {value}
        </div>
        {sub && (
          <div className="mt-0.5 font-mono text-sm text-primary-foreground/80 truncate">
            {sub}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-card-border bg-card p-3 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono truncate">
        {label}
      </div>
      <div className="mt-1 font-mono font-bold text-base text-foreground truncate">
        {value}
      </div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function JourneySummary({
  stations,
}: {
  stations: StationStatus[];
}) {
  const currentStation = findCurrentStation(stations);
  const totalDistance =
    stations[stations.length - 1]?.distance_from_source ?? null;
  const currentDistance = currentStation?.distance_from_source ?? null;

  const distanceValue =
    currentDistance != null && totalDistance != null
      ? `${currentDistance}/${totalDistance}`
      : totalDistance != null
        ? String(totalDistance)
        : "--";

  const durationMinutes = computeDurationMinutes(
    { scheduled_departure: stations[0]?.scheduled_departure },
    { scheduled_arrival: stations[stations.length - 1]?.scheduled_arrival },
  );

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 gap-3"
      data-testid="journey-summary"
    >
      <Stat
        hero
        label="Current Station"
        value={currentStation?.station_name ?? "--"}
        sub={
          currentStation?.station_code
            ? `[${currentStation.station_code}]`
            : undefined
        }
      />
      <Stat label="Distance" value={distanceValue} />
      <Stat
        label="Duration"
        value={durationMinutes != null ? formatDuration(durationMinutes) : "--"}
        sub={
          stations[0]?.scheduled_departure &&
          stations[stations.length - 1]?.scheduled_arrival
            ? `${stations[0].scheduled_departure} → ${stations[stations.length - 1].scheduled_arrival}`
            : undefined
        }
      />
      <Stat label="Stations" value={stations.length} />
    </div>
  );
}

function NextStopCard({ stations }: { stations: StationStatus[] }) {
  const next = findNextStation(stations);
  const currentDistance = findCurrentStation(stations)?.distance_from_source ?? null;

  if (!next) return null;

  const eta = next.scheduled_arrival ?? next.scheduled_departure ?? "--:--";
  const distanceAhead =
    currentDistance != null && next.distance_from_source != null
      ? Math.max(0, next.distance_from_source - currentDistance)
      : null;

  return (
    <div
      className="rounded-xl border border-card-border bg-card p-4"
      data-testid="next-stop-card"
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Next stop
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-2xl font-bold leading-none text-foreground">
            {next.station_code}
          </div>
          <div className="mt-1 truncate text-sm text-muted-foreground">
            {next.station_name}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="grid h-8 place-items-center rounded-full bg-muted px-3 font-mono text-sm font-semibold">
            {eta}
          </span>
          {distanceAhead != null && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {distanceAhead} KM ahead
            </span>
          )}
          {next.platform != null && next.platform !== "" && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              PF {next.platform}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ProgressBar({
  stations,
  sourceCode,
  destinationCode,
}: {
  stations: StationStatus[];
  sourceCode: string;
  destinationCode: string;
}) {
  const currentDistance =
    findCurrentStation(stations)?.distance_from_source ?? null;
  const totalDistance =
    stations[stations.length - 1]?.distance_from_source ?? null;
  const percent = computeProgressPercent(currentDistance, totalDistance);

  if (percent === null) return null;

  return (
    <div
      className="rounded-xl border border-card-border bg-card p-3 space-y-2"
      data-testid="progress-bar"
    >
      <div className="flex items-center justify-between font-mono text-xs font-bold uppercase tracking-wide">
        <span className="min-w-0 truncate">{sourceCode}</span>
        <span className="min-w-0 truncate">{destinationCode}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-foreground rounded-full"
          style={{ width: `${percent}%` }}
          data-testid="progress-bar-fill"
        />
      </div>
      <div className="flex justify-between font-mono text-xs text-muted-foreground">
        <span>{percent}% of journey completed</span>
        <span>{100 - percent}% remaining</span>
      </div>
    </div>
  );
}

function StationTimeline({ stations }: { stations: StationStatus[] }) {
  return (
    <div
      className="rounded-xl border border-card-border bg-card py-2"
      data-testid="station-timeline"
    >
      {stations.map((station) => {
        const isPassed = station.has_departed;
        const isCurrent = station.is_current;

        const timeSch =
          station.scheduled_arrival || station.scheduled_departure || "--:--";
        const timeAct = station.actual_arrival || station.actual_departure || null;
        const timeChanged = timeAct != null && timeAct !== timeSch;
        const delayMinutes = computeStationDelay(station);

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
                </span>
                {delayMinutes != null ? (
                  <DelayBadge delayMinutes={delayMinutes} />
                ) : isPassed ? (
                  <span className="shrink-0 font-mono text-xs tabular-nums">
                    {timeAct ?? timeSch}
                  </span>
                ) : null}
              </div>

              <div className="mt-0.5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                <span className="tabular-nums">{timeSch}</span>
                {timeChanged && (
                  <>
                    <span className="tabular-nums">{timeAct}</span>
                    <span className="text-[10px] uppercase tracking-widest">ACT</span>
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
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The status deep module: identity, summary, next stop, progress, and the
 * full station timeline, plus the loading and error states. Given a
 * `TrainStatusResult` it decides everything — the page just renders it.
 */
export function StatusView({ result }: { result: TrainStatusResult }) {
  const { data, isError, errorType, isPlaceholderData, isFetching, refetch } =
    result;

  if (isError) {
    return (
      <div
        className="rounded-xl border border-card-border bg-card p-5 flex flex-col items-center text-center gap-4"
        data-testid="status-error"
      >
        <h2 className="font-mono text-lg font-bold uppercase tracking-widest">
          Signal lost
        </h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {errorType ? ERROR_MESSAGES[errorType] : "Could not load train status."}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 font-mono text-sm font-semibold uppercase tracking-widest text-primary-foreground"
          data-testid="status-retry"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return <StatusSkeleton />;
  }

  const handleRefresh = () => void refetch();

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border border-card-border bg-card p-4"
        data-testid="train-identity-hero"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <h1
                className="font-mono text-2xl font-bold tracking-wider"
                data-testid="text-train-number"
              >
                {data.train_number}
              </h1>
              <span
                className="shrink-0 rounded-full border border-card-border px-2.5 py-0.5 font-mono text-xs tracking-widest text-muted-foreground"
                data-testid="text-train-name"
              >
                {data.train_name}
              </span>
            </div>
            <div className="mt-1 flex items-center gap-2 font-mono text-sm text-muted-foreground">
              <span>{data.source_station_name}</span>
              <span aria-hidden>→</span>
              <span>{data.destination_station_name}</span>
            </div>
          </div>
          {data.current_delay_minutes != null && (
            <DelayBadge
              delayMinutes={data.current_delay_minutes}
              testId="status-delay-badge"
            />
          )}
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 border-t border-card-border pt-3">
          <span className="flex items-center gap-1.5 font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {isPlaceholderData ? (
              <span data-testid="status-refreshing">Refreshing…</span>
            ) : (
              data.last_updated && (
                <span data-testid="status-updated">
                  Updated:{" "}
                  {new Date(data.last_updated).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              )
            )}
          </span>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={isFetching}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-card-border px-3 font-mono text-xs font-semibold uppercase tracking-widest disabled:opacity-50"
            data-testid="button-refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {data.status_message && (
        <p className="text-sm text-muted-foreground" data-testid="status-message">
          {data.status_message}
        </p>
      )}

      <JourneySummary stations={data.stations} />
      <NextStopCard stations={data.stations} />
      <ProgressBar
        stations={data.stations}
        sourceCode={data.source_station_code}
        destinationCode={data.destination_station_code}
      />
      <StationTimeline stations={data.stations} />
    </div>
  );
}

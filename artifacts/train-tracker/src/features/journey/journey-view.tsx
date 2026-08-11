import { useState } from "react";
import type { JSX } from "react";
import { RefreshCw } from "lucide-react";
import type { TrainStatusResponse } from "@workspace/api-client-react";
import { Button, Card, Label, Stat } from "@/components/primitives";
import type { StatTone } from "@/components/primitives";
import { GatewaySelector, GATEWAY_AUTO } from "@/components/gateway-selector";
import {
  formatDelayPhrase,
  formatDuration,
  formatRelativeTime,
} from "@/lib/format";
import { formatProviderName } from "@/lib/providers";
import {
  computeDurationMinutes,
  findCurrentStation,
  findNextStation,
} from "@/lib/status-metrics";
import type { StatusStationLike } from "@/lib/status-metrics";
import { JourneyRoute } from "./journey-route";
import { RunSelector } from "./run-selector";
import { SourceNotes } from "./source-notes";
import { StationTimeline } from "./station-timeline";
import { JourneyEmpty, JourneyError, JourneySkeleton } from "./journey-states";
import { useJourney } from "./journey-slice";
import type { JourneySlice } from "./journey-slice";

function heroTone(delayMinutes: number | null): StatTone {
  if (delayMinutes === null || delayMinutes === 0) return "success";
  if (delayMinutes > 0) return "warning";
  return "neutral";
}

function stationIndex(
  stations: StatusStationLike[],
  predicate: (station: StatusStationLike) => boolean,
): number | null {
  const index = stations.findIndex(predicate);
  return index >= 0 ? index : null;
}

function NextStopCard({ stations }: { stations: StatusStationLike[] }) {
  const next = findNextStation(stations);
  if (!next) return null;

  const eta = next.scheduled_arrival ?? next.scheduled_departure ?? "--:--";
  const current = findCurrentStation(stations);
  const distanceAhead =
    current?.distance_from_source != null && next.distance_from_source != null
      ? Math.max(0, next.distance_from_source - current.distance_from_source)
      : null;

  return (
    <div
      className="rounded-xl border border-card-border bg-card p-4"
      data-testid="next-stop-card"
    >
      <Label tone="muted">Next stop</Label>
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
          {next.day > 1 && (
            <span className="font-mono text-[10px] text-muted-foreground">
              Day {next.day}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function JourneySummary({ stations }: { stations: StatusStationLike[] }) {
  const durationMinutes = computeDurationMinutes(
    { scheduled_departure: stations[0]?.scheduled_departure },
    { scheduled_arrival: stations[stations.length - 1]?.scheduled_arrival },
  );
  const origin = stations[0];
  const destination = stations[stations.length - 1];
  const route =
    origin && destination
      ? `${origin.station_name} → ${destination.station_name}`
      : "--";

  return (
    <div
      className="grid grid-cols-3 gap-3"
      data-testid="journey-summary"
    >
      <Stat label="Route" value={route} />
      <Stat
        label="Duration"
        value={durationMinutes != null ? formatDuration(durationMinutes) : "--"}
      />
      <Stat label="Stops" value={stations.length} />
    </div>
  );
}

interface JourneyStatusProps {
  data: TrainStatusResponse;
  dates: JourneySlice["dates"];
  selectDate: JourneySlice["selectDate"];
  gateway: JourneySlice["gateway"];
  setGateway: JourneySlice["setGateway"];
  gateways: JourneySlice["gateways"];
  refresh: JourneySlice["refresh"];
  isFetching: boolean;
  refreshing: boolean;
  stale: boolean;
  updatedAt: number | null;
  liveEnabled: boolean;
  onToggleLive: (enabled: boolean) => void;
}

function JourneyStatus({
  data,
  dates,
  selectDate,
  gateway,
  setGateway,
  gateways,
  refresh,
  isFetching,
  refreshing,
  stale,
  updatedAt,
  liveEnabled,
  onToggleLive,
}: JourneyStatusProps) {
  const [showAll, setShowAll] = useState(false);
  const [showGateway, setShowGateway] = useState(false);

  const stations = data.stations;
  const currentIndex = stationIndex(stations, (station) => station.is_current);
  const nextIndex = stationIndex(
    stations,
    (station) => !station.has_departed && !station.is_current,
  );
  const currentDelay = data.current_delay_minutes ?? null;
  const updatedLabel =
    updatedAt !== null ? formatRelativeTime(updatedAt) : null;
  const providerLabel =
    gateway !== GATEWAY_AUTO ? formatProviderName(gateway) : null;

  return (
    <div className="space-y-4">
      <Card data-testid="train-identity-hero" className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <Stat
            hero
            label="Status"
            value={formatDelayPhrase(currentDelay)}
            tone={heroTone(currentDelay)}
            className="lg:w-72"
          />
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
        </div>

        {data.status_message && (
          <p
            className="text-sm text-muted-foreground"
            data-testid="status-message"
          >
            {data.status_message}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-card-border pt-3">
          <SourceNotes
            updatedLabel={updatedLabel}
            providerLabel={providerLabel}
            refreshing={refreshing}
            stale={stale}
          />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="live-status-toggle"
              aria-pressed={liveEnabled}
              onClick={() => onToggleLive(!liveEnabled)}
            >
              Live {liveEnabled ? "on" : "off"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="button-refresh"
              disabled={isFetching}
              onClick={refresh}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <NextStopCard stations={stations} />
        <JourneySummary stations={stations} />
      </div>

      <JourneyRoute
        stations={stations}
        currentIndex={currentIndex}
        nextIndex={nextIndex}
      />

      <RunSelector dates={dates} onSelect={selectDate} />

      <StationTimeline
        stations={stations}
        showAll={showAll}
        onToggleShowAll={() => setShowAll((value) => !value)}
      />

      <div className="rounded-xl border border-card-border bg-card">
        <Button
          variant="ghost"
          size="sm"
          data-testid="gateway-toggle"
          aria-expanded={showGateway}
          onClick={() => setShowGateway((value) => !value)}
          className="w-full justify-between"
        >
          Data source
        </Button>
        {showGateway && (
          <div className="px-2 pb-2">
            <GatewaySelector
              gateways={gateways}
              value={gateway}
              onChange={setGateway}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function JourneyView({
  trainNumber,
}: {
  trainNumber: string | null;
}): JSX.Element | null {
  const {
    selected,
    dates,
    activeDate,
    selectDate,
    gateway,
    setGateway,
    gateways,
    status,
    refresh,
    autoRefresh,
  } = useJourney(trainNumber);

  if (selected === null) return null;

  if (status.isLoading) {
    return <JourneySkeleton />;
  }

  if (status.isError) {
    return (
      <JourneyError
        errorType={status.errorType}
        trainNumber={selected.trainNumber}
        departureDate={activeDate}
        onRetry={refresh}
      />
    );
  }

  const data = status.data;
  if (data) {
    return (
      <JourneyStatus
        data={data}
        dates={dates}
        selectDate={selectDate}
        gateway={gateway}
        setGateway={setGateway}
        gateways={gateways}
        refresh={refresh}
        isFetching={status.isFetching}
        refreshing={status.isFetching && status.isPlaceholderData}
        stale={status.isPlaceholderData}
        updatedAt={
          data.last_updated ? new Date(data.last_updated).getTime() : null
        }
        liveEnabled={autoRefresh.enabled}
        onToggleLive={(enabled) => autoRefresh.setEnabled(enabled)}
      />
    );
  }

  return (
    <JourneyEmpty
      trainNumber={selected.trainNumber}
      departureDate={activeDate}
      onSelectDate={selectDate}
    />
  );
}

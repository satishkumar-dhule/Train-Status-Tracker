import type { ReactNode } from "react";
import type { StationStatus } from "@workspace/api-client-react";
import { formatDuration } from "@workspace/trains-data";
import { useI18n } from "@/lib/i18n";

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-card-border bg-background/60 p-3 min-w-0">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-semibold truncate">
        {label}
      </div>
      <div className="mt-1 font-mono font-bold text-sm md:text-base text-foreground truncate">
        {value}
      </div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div>}
    </div>
  );
}

export function JourneySummary({
  currentStation,
  totalDistance,
  currentDistance,
  durationMinutes,
  scheduledDeparture,
  scheduledArrival,
  stationCount,
}: {
  currentStation: StationStatus | null;
  totalDistance: number | null;
  currentDistance: number | null;
  durationMinutes: number | null;
  scheduledDeparture: string | null;
  scheduledArrival: string | null;
  stationCount: number;
}) {
  const { t } = useI18n();

  const distanceValue =
    currentDistance != null && totalDistance != null
      ? `${currentDistance}/${totalDistance}`
      : totalDistance != null
        ? String(totalDistance)
        : "--";

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="journey-summary">
      <Stat
        label={t("label.currentStation")}
        value={currentStation?.station_name ?? "--"}
        sub={currentStation?.station_code ? `[${currentStation.station_code}]` : undefined}
      />
      <Stat label={t("meta.kilometers", { n: "" })} value={distanceValue} />
      <Stat
        label={t("label.duration")}
        value={durationMinutes != null ? formatDuration(durationMinutes) : "--"}
        sub={
          scheduledDeparture && scheduledArrival
            ? `${scheduledDeparture} → ${scheduledArrival}`
            : undefined
        }
      />
      <Stat label={t("label.stations")} value={stationCount} />
    </div>
  );
}

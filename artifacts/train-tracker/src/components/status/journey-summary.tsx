import type { ReactNode } from "react";
import type { StationStatus } from "@workspace/api-client-react";
import { formatDuration } from "@workspace/trains-data";
import { useI18n } from "@/lib/i18n";

function Stat({
  label,
  value,
  sub,
  hero = false,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  hero?: boolean;
}) {
  if (hero) {
    return (
      <div className="relative overflow-hidden rounded-xl bg-primary p-3 min-w-0">
        <div className="text-xs uppercase tracking-widest text-primary-foreground/70 font-mono truncate">
          {label}
        </div>
        <div className="mt-1 font-sans font-semibold text-lg text-white truncate">{value}</div>
        {sub && <div className="mt-0.5 font-mono text-sm text-brand truncate">{sub}</div>}
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-card-border bg-card p-3 min-w-0">
      <div className="text-xs uppercase tracking-widest text-muted-foreground font-mono truncate">
        {label}
      </div>
      <div className="mt-1 font-mono font-bold text-base text-primary truncate">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground truncate">{sub}</div>}
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
      <div className="col-span-2 md:col-span-1">
        <Stat
          hero
          label={t("label.currentStation")}
          value={currentStation?.station_name ?? "--"}
          sub={currentStation?.station_code ? `[${currentStation.station_code}]` : undefined}
        />
      </div>
      <Stat label={t("label.distance")} value={distanceValue} />
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

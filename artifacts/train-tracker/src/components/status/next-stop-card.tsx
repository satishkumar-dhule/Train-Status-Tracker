import type { StationStatus } from "@workspace/api-client-react";
import { useI18n } from "@/lib/i18n";
import { findNextStation } from "@/lib/status-metrics";

/**
 * The next stop is the single most important datum mid-journey, so it stays
 * visible regardless of the active view (track or timeline). Renders nothing
 * once the train has reached the terminus.
 */
export function NextStopCard({
  stations,
  currentDistance,
}: {
  stations: StationStatus[];
  currentDistance: number | null;
}) {
  const { t } = useI18n();
  const next = findNextStation(stations);

  if (!next) return null;

  const eta = next.scheduled_arrival ?? next.scheduled_departure ?? "--:--";
  const distanceAhead =
    currentDistance != null && next.distance_from_source != null
      ? Math.max(0, next.distance_from_source - currentDistance)
      : null;

  return (
    <div
      className="rounded-2xl border border-card-border bg-card p-4"
      data-testid="next-stop-card"
    >
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Next stop
      </div>
      <div className="mt-1 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-2xl font-bold leading-none text-primary">
            {next.station_code}
          </div>
          <div className="mt-1 truncate font-sans text-sm text-muted-foreground">
            {next.station_name}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="grid h-8 place-items-center rounded-full bg-brand-soft px-3 font-mono text-sm font-semibold text-brand">
            {eta}
          </span>
          {distanceAhead != null && (
            <span className="font-mono text-[10px] text-muted-foreground">
              {t("meta.kilometers", { n: distanceAhead })}
            </span>
          )}
          {next.platform != null && next.platform !== "" && (
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {t("meta.platform", { n: next.platform })}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

import { Label, Pill } from "@/components/primitives";
import { cn } from "@/lib/utils";

export interface SourceNotesProps {
  updatedLabel: string | null;
  providerLabel: string | null;
  refreshing: boolean;
  stale: boolean;
}

export function SourceNotes({
  updatedLabel,
  providerLabel,
  refreshing,
  stale,
}: SourceNotesProps) {
  return (
    <div
      data-testid="source-notes"
      aria-live={refreshing ? "polite" : undefined}
      aria-label={stale ? "Status stale" : undefined}
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1")}
    >
      <Label tone="muted" className="flex flex-wrap items-center gap-x-1.5">
        {updatedLabel === null ? (
          "Status unavailable"
        ) : (
          <>
            <span data-testid="status-updated">Updated {updatedLabel}</span>
            {providerLabel !== null && (
              <>
                <span aria-hidden>·</span>
                <span data-testid="status-provider">via {providerLabel}</span>
              </>
            )}
          </>
        )}
        {refreshing && (
          <span data-testid="status-refreshing">Refreshing…</span>
        )}
      </Label>
      {stale && <Pill variant="stale">Stale</Pill>}
    </div>
  );
}

import { cn } from "../lib/utils";

export interface RunTab {
  /** YYYYMMDD — the value passed back on selection. */
  apiDate: string;
  /** YYYY-MM-DD — for the title attribute / accessibility. */
  iso: string;
  /** Short label: "Today", "Next", or "7 Aug". */
  label: string;
  /** Secondary line, e.g. the full short date for Today/Next. */
  sub?: string;
}

/**
 * Horizontal run-date picker: one tab per run (previous 2, current, next 1).
 * The active run is inverted; clicking a tab selects that run's date.
 */
export function RunSelector({
  dates,
  active,
  onChange,
}: {
  dates: RunTab[];
  active: string;
  onChange: (apiDate: string) => void;
}) {
  return (
    <div
      className="overflow-x-auto rounded-xl border border-card-border bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="run-selector"
    >
      <div role="group" aria-label="Run dates" className="flex gap-1">
        {dates.map(({ apiDate, iso, label, sub }) => {
          const isActive = active === apiDate;
          return (
            <button
              key={apiDate}
              type="button"
              title={iso}
              aria-pressed={isActive}
              onClick={() => onChange(apiDate)}
              className={cn(
                "min-w-[88px] flex-1 rounded-lg px-3 py-2 text-center transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
              data-testid={`tab-date-${apiDate}`}
            >
              <span className="block font-mono text-[10px] font-semibold uppercase tracking-widest">
                {label}
              </span>
              {sub && (
                <span
                  className="mt-0.5 block font-mono text-[10px] opacity-70"
                  aria-hidden
                >
                  {sub}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

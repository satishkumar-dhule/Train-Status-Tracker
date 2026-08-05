import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export interface DateTab {
  iso: string;
  apiDate: string;
  label: string;
  sub?: string;
}

function formatShortDate(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.toLocaleDateString("en-US", { day: "2-digit" });
  const month = d.toLocaleDateString("en-US", { month: "short" });
  return `${day} ${month.toUpperCase()}`;
}

export function DateTabs({
  dates,
  active,
  onChange,
}: {
  dates: DateTab[];
  active: string;
  onChange: (apiDate: string) => void;
}) {
  const { t } = useI18n();
  const stripRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const check = () => setOverflowing(strip.scrollWidth > strip.clientWidth);
    check();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(check);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [dates]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const activeTab = strip.querySelector<HTMLElement>(`[data-testid="tab-date-${active}"]`);
    activeTab?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [active]);

  return (
    <div className="relative bg-card border border-card-border rounded-2xl overflow-hidden">
      <div
        ref={stripRef}
        role="group"
        aria-label={t("label.departureDate")}
        className="flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x snap-mandatory"
        data-testid="date-tabs"
      >
        {dates.map(({ iso, apiDate, label, sub }) => {
          const isActive = active === apiDate;
          const day = new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
            weekday: "short",
          });
          const dateSub = sub ?? (label === t("label.today") ? formatShortDate(iso) : null);
          return (
            <button
              key={apiDate}
              type="button"
              onClick={() => onChange(apiDate)}
              aria-pressed={isActive}
              title={iso}
              className={cn(
                "relative min-w-[104px] snap-start px-4 py-3 text-center transition-colors",
                isActive
                  ? "bg-brand-soft text-primary"
                  : "text-muted-foreground hover:bg-muted/60"
              )}
              data-testid={`tab-date-${apiDate}`}
            >
              <span className="block text-[10px] font-sans font-medium uppercase tracking-wider text-muted-foreground">
                {day}
              </span>
              <span
                className={cn(
                  "block font-sans font-semibold text-sm",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                {label}
              </span>
              {dateSub && (
                <span className="block font-mono text-[10px] text-muted-foreground">
                  {dateSub}
                </span>
              )}
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand"
                />
              )}
            </button>
          );
        })}
      </div>
      {overflowing && (
        <div className="pointer-events-none absolute inset-y-0 end-0 w-8 bg-gradient-to-l from-background to-transparent" />
      )}
    </div>
  );
}

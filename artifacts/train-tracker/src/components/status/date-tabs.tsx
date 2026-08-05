import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";

export interface DateTab {
  iso: string;
  apiDate: string;
  label: string;
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
    <div className="relative">
      <div
        ref={stripRef}
        role="group"
        aria-label={t("label.departureDate")}
        className="flex gap-2 px-1 py-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden scroll-snap-x snap-x snap-mandatory"
        data-testid="date-tabs"
      >
        {dates.map(({ iso, apiDate, label }) => {
          const isActive = active === apiDate;
          return (
            <button
              key={apiDate}
              type="button"
              onClick={() => onChange(apiDate)}
              aria-pressed={isActive}
              title={iso}
              className={cn(
                "shrink-0 [scroll-snap-align:start] rounded-md border px-3 h-10 inline-flex items-center font-mono text-xs font-semibold uppercase tracking-widest transition-all",
                isActive
                  ? "border-primary bg-brand text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
              data-testid={`tab-date-${apiDate}`}
            >
              {label}
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

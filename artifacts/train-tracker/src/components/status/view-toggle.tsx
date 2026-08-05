import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { TrainView } from "@/hooks/use-view-preference";

export function ViewToggle({
  value,
  onChange,
}: {
  value: TrainView;
  onChange: (view: TrainView) => void;
}) {
  const { t } = useI18n();
  const options: Array<{ value: TrainView; label: string }> = [
    { value: "timeline", label: t("view.timeline") },
    { value: "track", label: t("view.track") },
  ];

  return (
    <div
      role="group"
      aria-label={t("label.view")}
      className="flex gap-1 p-1 rounded-lg border border-border bg-card"
      data-testid="view-toggle"
    >
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={cn(
              "shrink-0 rounded-md border px-3.5 h-10 inline-flex items-center font-mono text-xs font-semibold uppercase tracking-widest transition-all",
              active
                ? "border-primary bg-brand text-primary-foreground"
                : "border-transparent bg-transparent text-muted-foreground hover:text-foreground",
            )}
            data-testid={`view-${option.value}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

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
      className="inline-flex rounded-full bg-muted p-1 gap-1"
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
              "h-9 px-4 rounded-full font-sans text-sm font-medium inline-flex items-center gap-1.5 transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
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

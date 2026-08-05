import { useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useDisplayPreferences,
  type DisplayMode,
} from "@/hooks/use-display-preferences";

const OPTION_KEYS: Array<{ mode: DisplayMode; labelKey: Key }> = [
  { mode: "default", labelKey: "display.default" },
  { mode: "high-contrast", labelKey: "display.highContrast" },
  { mode: "big-fonts", labelKey: "display.bigFonts" },
  { mode: "bw", labelKey: "display.blackWhite" },
];

export function DisplaySettings({ className }: { className?: string }) {
  const { t } = useI18n();
  const [mode, setMode] = useDisplayPreferences();
  const [open, setOpen] = useState(false);

  const select = (next: DisplayMode) => {
    setMode(next);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "h-10 w-10 grid place-items-center rounded-full bg-primary/10 text-primary hover:bg-primary/20",
            className,
          )}
          aria-label={t("label.display")}
          data-testid="button-display-settings"
        >
          <Settings2 className="h-5 w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-3"
        data-testid="display-settings-popover"
      >
        <div className="space-y-2">
          <div className="px-1 font-mono text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t("label.display")}
          </div>
          <div role="group" aria-label={t("label.display")}>
            {OPTION_KEYS.map(({ mode: option, labelKey }) => {
              const active = mode === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => select(option)}
                  aria-pressed={active}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 font-sans text-sm transition-colors hover:bg-muted",
                    active
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground",
                  )}
                  data-testid={`display-mode-${option}`}
                >
                  {t(labelKey)}
                  {active && <Check className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

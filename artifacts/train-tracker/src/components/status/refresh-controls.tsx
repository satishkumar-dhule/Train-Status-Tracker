import { RefreshCw } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui";
import { Switch } from "@/components/ui/switch";

/**
 * Manual refresh + auto-refresh controls for the running-status hero.
 * Presentational: the caller owns the fetching state and the auto-refresh
 * preference.
 */
export function RefreshControls({
  isFetching,
  autoRefresh,
  onRefresh,
  onAutoRefreshChange,
}: {
  isFetching: boolean;
  autoRefresh: boolean;
  onRefresh: () => void;
  onAutoRefreshChange: (enabled: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={isFetching}
        className="font-mono uppercase tracking-widest"
        data-testid="status-refresh"
      >
        <RefreshCw
          className={cn("w-3.5 h-3.5", isFetching && "animate-spin")}
        />
        {t("action.refresh")}
      </Button>

      <label className="flex items-center gap-2 text-xs text-muted-foreground font-mono uppercase tracking-widest cursor-pointer select-none">
        <Switch
          checked={autoRefresh}
          onCheckedChange={onAutoRefreshChange}
          data-testid="toggle-auto-refresh"
        />
        <span>{t("status.autoRefresh")}</span>
      </label>
    </div>
  );
}

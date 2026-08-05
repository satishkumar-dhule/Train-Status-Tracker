import { Badge } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export function DelayBadge({ delayMinutes }: { delayMinutes: number | null }) {
  const { t } = useI18n();

  if (delayMinutes === null) return null;

  if (delayMinutes > 0) {
    return (
      <Badge className="text-xs h-6 px-2.5 border-warning bg-warning text-warning-foreground shrink-0 tracking-widest">
        {t("status.lateMinutes", { n: delayMinutes })}
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className="text-xs h-6 px-2.5 border-success text-success shrink-0 tracking-widest bg-success/5"
    >
      {t("status.onTime")}
    </Badge>
  );
}

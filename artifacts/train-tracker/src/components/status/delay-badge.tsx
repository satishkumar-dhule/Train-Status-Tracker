import { Badge } from "@/components/ui";
import { useI18n } from "@/lib/i18n";

export function DelayBadge({ delayMinutes }: { delayMinutes: number | null }) {
  const { t } = useI18n();

  if (delayMinutes === null) return null;

  if (delayMinutes > 0) {
    return (
      <Badge className="h-6 px-2.5 rounded-full text-xs font-semibold bg-warning text-warning-foreground font-mono normal-case shrink-0">
        {t("status.lateMinutes", { n: delayMinutes })}
      </Badge>
    );
  }

  return (
    <Badge className="h-6 px-2.5 rounded-full text-xs font-semibold bg-success text-success-foreground font-sans normal-case shrink-0">
      {t("status.onTime")}
    </Badge>
  );
}

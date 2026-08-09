import { cn } from "../lib/utils";

/**
 * Semantic delay pill: amber when late, green when on time. The status colors
 * are the only hues left in the otherwise black & white theme.
 */
export function DelayBadge({
  delayMinutes,
  testId,
}: {
  delayMinutes: number | null | undefined;
  testId?: string;
}) {
  if (delayMinutes === null || delayMinutes === undefined) return null;

  const delayed = delayMinutes > 0;

  return (
    <span
      data-testid={testId}
      data-variant={delayed ? "late" : "on-time"}
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2.5 font-mono text-xs font-semibold normal-case",
        delayed
          ? "bg-warning text-warning-foreground"
          : "bg-success text-success-foreground",
      )}
    >
      {delayed ? `+${delayMinutes} min` : "On time"}
    </span>
  );
}

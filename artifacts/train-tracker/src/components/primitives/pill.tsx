import { CheckCircle2, TriangleAlert, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PillVariant =
  "on-time" | "late" | "cancelled" | "stale" | "neutral" | "info";

export type PillSize = "sm" | "md";

const variantClasses: Record<PillVariant, string> = {
  "on-time": "border-on-time bg-on-time text-on-time-fg",
  late: "border-late bg-late text-late-fg",
  cancelled: "border-cancelled bg-cancelled text-cancelled-fg",
  stale: "border-stale bg-stale text-stale-fg",
  neutral: "border-card-border bg-secondary text-secondary-foreground",
  info: "border-primary/30 bg-primary/10 text-primary",
};

const sizeClasses: Record<PillSize, string> = {
  sm: "gap-1 px-2 py-0.5 text-[10px]",
  md: "gap-1.5 px-2.5 py-0.5 text-xs",
};

export interface PillProps {
  variant: PillVariant;
  size?: PillSize;
  icon?: ReactNode;
  announce?: boolean;
  testId?: string;
  className?: string;
  children: ReactNode;
}

export function Pill({
  variant,
  size = "md",
  icon,
  announce = false,
  testId,
  className,
  children,
}: PillProps) {
  const iconSize = size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5";

  let defaultIcon: ReactNode;
  switch (variant) {
    case "on-time":
      defaultIcon = <CheckCircle2 className={iconSize} aria-hidden />;
      break;
    case "late":
      defaultIcon = <TriangleAlert className={iconSize} aria-hidden />;
      break;
    case "cancelled":
      defaultIcon = <XCircle className={iconSize} aria-hidden />;
      break;
    default:
      defaultIcon = (
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      );
  }

  return (
    <span
      data-testid={testId}
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      className={cn(
        "inline-flex items-center rounded-full border font-mono font-bold uppercase tracking-widest whitespace-nowrap",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
    >
      {icon ?? defaultIcon}
      {children}
    </span>
  );
}

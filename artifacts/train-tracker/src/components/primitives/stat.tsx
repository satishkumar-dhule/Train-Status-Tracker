import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "./label";

export type StatTone =
  "neutral" | "success" | "warning" | "destructive" | "muted";

const toneClasses: Record<StatTone, string> = {
  neutral: "",
  success: "text-success",
  warning: "text-warning",
  destructive: "text-destructive",
  muted: "text-muted-foreground",
};

export interface StatProps {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: StatTone;
  hero?: boolean;
  testId?: string;
  className?: string;
}

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  hero = false,
  testId,
  className,
}: StatProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "min-w-0 rounded-xl border border-card-border bg-card p-3 text-card-foreground",
        hero && "border-primary bg-primary text-primary-foreground",
        className,
      )}
    >
      <Label
        tone="muted"
        className={hero ? "text-primary-foreground/70" : undefined}
      >
        {label}
      </Label>
      <div
        className={cn(
          "mt-1 truncate font-mono font-bold",
          hero ? "text-5xl tracking-tight" : "text-2xl",
          toneClasses[tone],
        )}
      >
        {value ?? "--"}
      </div>
      {sub && (
        <div
          className={cn(
            "mt-0.5 truncate font-mono text-xs",
            hero ? "text-primary-foreground/80" : "text-muted-foreground",
          )}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

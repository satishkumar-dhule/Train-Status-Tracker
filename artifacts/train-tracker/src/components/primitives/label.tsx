import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type LabelTone = "default" | "muted";

export interface LabelProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: LabelTone;
}

export function Label({ tone = "default", className, ...rest }: LabelProps) {
  return (
    <span
      className={cn(
        "font-mono text-[10px] uppercase tracking-widest",
        tone === "default" ? "text-foreground" : "text-muted-foreground",
        className,
      )}
      {...rest}
    />
  );
}

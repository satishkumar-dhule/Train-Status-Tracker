import type { ElementType, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type CardElement = "div" | "section" | "article";
export type CardPadding = "sm" | "md" | "lg" | "none";

const paddingClasses: Record<CardPadding, string> = {
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
  none: "",
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: CardElement;
  padding?: CardPadding;
}

export function Card({
  as = "div",
  padding = "md",
  className,
  children,
  ...rest
}: CardProps) {
  const Tag = as as ElementType;
  return (
    <Tag
      className={cn(
        "rounded-xl border border-card-border bg-card text-card-foreground shadow-sm",
        paddingClasses[padding],
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

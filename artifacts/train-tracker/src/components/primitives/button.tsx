import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  "primary" | "secondary" | "outline" | "ghost" | "danger";

export type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground transition-opacity hover:opacity-80",
  secondary:
    "bg-secondary text-secondary-foreground transition-opacity hover:opacity-80",
  outline:
    "border border-card-border text-foreground transition-colors hover:bg-muted",
  ghost: "text-foreground transition-colors hover:bg-muted",
  danger:
    "bg-destructive text-destructive-foreground transition-opacity hover:opacity-80",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-8 min-w-8 gap-1 rounded-md px-2.5 text-xs",
  md: "min-h-11 gap-1.5 rounded-lg px-3 text-xs",
  lg: "min-h-11 gap-2 rounded-lg px-4 text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      type = "button",
      className,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "inline-flex select-none items-center justify-center font-mono font-semibold uppercase tracking-widest disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

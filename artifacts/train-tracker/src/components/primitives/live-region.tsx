import type { ReactNode } from "react";

export interface LiveRegionProps {
  children: ReactNode;
  label?: string;
}

export function LiveRegion({ children, label }: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={label}
      className="sr-only"
    >
      {children}
    </div>
  );
}

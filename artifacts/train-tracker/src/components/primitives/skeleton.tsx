import { cn } from "@/lib/utils";

export interface SkeletonProps {
  lines?: number;
  className?: string;
  testId?: string;
}

export function Skeleton({ lines = 3, className, testId }: SkeletonProps) {
  return (
    <div
      data-testid={testId}
      aria-hidden={testId ? undefined : true}
      className={cn("space-y-3", className)}
    >
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="h-4 rounded-md bg-muted skeleton-shimmer" />
      ))}
    </div>
  );
}

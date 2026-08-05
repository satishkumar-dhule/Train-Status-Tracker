import { Skeleton } from "@/components/ui";

export function StatusSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3" data-testid="status-skeleton">
      <div className="bg-card border border-card-border rounded-2xl p-4 space-y-3 animate-pulse-fast">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-28 bg-border/30" />
          <Skeleton className="h-8 w-44 bg-border/30" />
        </div>
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse-fast">
            <Skeleton className="h-3 w-3 rounded-full bg-border/50 shrink-0 mt-1.5" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4 bg-border/30" />
              <Skeleton className="h-3 w-1/2 bg-border/30" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

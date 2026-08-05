import { Skeleton } from "@/components/ui";

export function StatusSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-6" data-testid="status-skeleton">
      <div className="rounded-2xl border border-card-border bg-card p-4 md:p-5 space-y-3 animate-pulse-fast">
        <Skeleton className="h-8 w-2/3 max-w-64 bg-border/30" />
        <Skeleton className="h-4 w-1/2 max-w-48 bg-border/30" />
        <Skeleton className="h-4 w-full bg-border/30" />
      </div>
      <div className="space-y-0 relative ps-4">
        <div className="absolute top-0 bottom-0 start-[2.4rem] w-px bg-border/30" />
        {[...Array(rows)].map((_, i) => (
          <div key={i} className="flex gap-4 py-4 relative z-10 animate-pulse-fast">
            <Skeleton className="w-16 h-4 bg-border/30" />
            <div className="w-3 h-3 rounded-full bg-border/50 shrink-0 mt-0.5" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-2/3 max-w-56 bg-border/30" />
              <Skeleton className="h-4 w-1/3 min-w-24 bg-border/30" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

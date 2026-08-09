export function StatusSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" data-testid="status-skeleton">
      <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
        <div className="h-7 w-32 rounded bg-muted" />
        <div className="h-4 w-56 rounded bg-muted" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-3">
            <div className="mt-1.5 h-3 w-3 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 rounded bg-muted" />
              <div className="h-3 w-1/2 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

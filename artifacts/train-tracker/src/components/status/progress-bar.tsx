export function ProgressBar({
  percent,
  sourceCode,
  destinationCode,
}: {
  percent: number | null;
  sourceCode: string;
  destinationCode: string;
}) {
  if (percent === null) return null;

  const remaining = 100 - percent;

  return (
    <div
      className="bg-card border border-card-border rounded-2xl p-3 space-y-2"
      data-testid="progress-bar"
    >
      <div className="flex items-center justify-between font-mono text-xs font-bold uppercase tracking-wide">
        <div className="flex flex-col">
          <span className="text-[9px] font-sans font-semibold tracking-widest text-muted-foreground">
            SOURCE
          </span>
          <span>{sourceCode}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[9px] font-sans font-semibold tracking-widest text-muted-foreground">
            DESTINATION
          </span>
          <span>{destinationCode}</span>
        </div>
      </div>
      <div className="relative h-2 rounded-full bg-muted/70 overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 bg-brand rounded-full"
          style={{ width: `${percent}%` }}
          data-testid="progress-bar-fill"
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-3.5 w-3.5 rounded-full bg-brand border-2 border-white"
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="flex justify-between items-center">
        <span className="font-mono text-xs text-muted-foreground">
          {percent}% of journey completed
        </span>
        <span className="font-mono text-xs text-muted-foreground">{remaining}% remaining</span>
      </div>
    </div>
  );
}

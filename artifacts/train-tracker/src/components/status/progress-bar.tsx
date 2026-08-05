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

  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs uppercase tracking-widest text-muted-foreground font-semibold">
          {sourceCode} → {destinationCode}
        </span>
        <span className="font-mono text-xs font-bold text-primary">{percent}%</span>
      </div>
      <div className="h-2.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-brand transition-all duration-700"
          style={{ width: `${percent}%` }}
          data-testid="progress-bar"
        />
      </div>
    </div>
  );
}

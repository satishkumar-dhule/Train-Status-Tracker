import type { TrainEntry } from "@workspace/trains-data";

export interface RecentChipsProps {
  recent: TrainEntry[];
  onSelect: (train: TrainEntry) => void;
}

export function RecentChips({ recent, onSelect }: RecentChipsProps) {
  return (
    <ul className="flex flex-wrap gap-2">
      {recent.map((train) => (
        <li key={train.number} className="min-w-0 max-w-full">
          <button
            type="button"
            onClick={() => onSelect(train)}
            className="group flex items-start gap-2 rounded-full border border-border bg-card px-2.5 py-2 text-sm transition-colors hover:border-primary/60"
            data-testid={`recent-chip-${train.number}`}
          >
            <span className="mt-0.5 shrink-0 font-mono font-bold tracking-wider text-primary bg-primary/10 rounded-full px-2 py-0.5 text-xs">
              {train.number}
            </span>
            <span
              className="min-w-0 whitespace-normal text-start leading-snug text-muted-foreground group-hover:text-foreground"
              data-testid={`recent-chip-name-${train.number}`}
            >
              {train.name}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

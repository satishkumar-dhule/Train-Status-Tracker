import type { TrainEntry } from "@workspace/trains-data";

export interface RecentChipsProps {
  recent: TrainEntry[];
  onSelect: (train: TrainEntry) => void;
}

export function RecentChips({ recent, onSelect }: RecentChipsProps) {
  return (
    <ul className="space-y-2">
      {recent.map((train) => (
        <li key={train.number} className="min-w-0">
          <button
            type="button"
            onClick={() => onSelect(train)}
            className="group flex w-full items-center gap-3 rounded-xl border border-card-border bg-card px-3 py-2.5 min-h-[44px] text-start transition-colors hover:border-primary/40"
            data-testid={`recent-chip-${train.number}`}
          >
            <span className="h-9 w-9 rounded-lg bg-primary/10 text-primary font-mono text-sm font-bold grid place-items-center shrink-0">
              {train.number.charAt(0)}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block font-mono text-sm font-semibold text-primary">
                {train.number}
              </span>
              <span
                className="block text-sm text-muted-foreground whitespace-normal group-hover:text-foreground"
                data-testid={`recent-chip-name-${train.number}`}
              >
                {train.name}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

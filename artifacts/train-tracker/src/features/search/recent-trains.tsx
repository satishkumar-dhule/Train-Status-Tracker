import { cn } from "@/lib/utils";
import type { SuggestionItem } from "./search-slice";

export interface RecentTrainsProps {
  items: SuggestionItem[];
  startIndex: number;
  highlightedIndex: number;
  onSelect: (item: SuggestionItem) => void;
}

export function RecentTrains({
  items,
  startIndex,
  highlightedIndex,
  onSelect,
}: RecentTrainsProps) {
  if (items.length === 0) return null;

  return (
    <>
      <li role="presentation">
        <div
          role="group"
          aria-label="Recent"
          data-testid="search-recents"
          className="px-4 pb-1 pt-2 font-mono text-[10px] uppercase tracking-widest text-muted-foreground"
        >
          Recent
        </div>
      </li>
      {items.map((item, index) => {
        const optionIndex = startIndex + index;
        return (
          <li
            key={item.id}
            data-option-index={optionIndex}
            id={item.id}
            role="option"
            aria-selected={optionIndex === highlightedIndex}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onSelect(item)}
            className={cn(
              "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5",
              optionIndex === highlightedIndex && "bg-muted",
            )}
          >
            <span className="shrink-0 font-mono text-sm font-bold tracking-wider">
              {item.trainNumber}
            </span>
            <span
              className="min-w-0 flex-1 truncate text-start text-xs text-muted-foreground"
              data-testid={`recent-row-${item.trainNumber}`}
            >
              {item.trainName}
            </span>
          </li>
        );
      })}
    </>
  );
}

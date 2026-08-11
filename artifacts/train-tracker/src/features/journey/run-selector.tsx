import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { Button, Pill } from "@/components/primitives";
import { cn } from "@/lib/utils";

export interface RunTab {
  apiDate: string;
  iso: string;
  label: string;
  isDefault?: boolean;
  isSelected?: boolean;
}

export function RunSelector({
  dates,
  onSelect,
}: {
  dates: RunTab[];
  onSelect: (apiDate: string) => void;
}) {
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  if (dates.length === 0) {
    return null;
  }

  const selectedIndex = dates.findIndex((date) => date.isSelected);
  const tabbableIndex = selectedIndex >= 0 ? selectedIndex : 0;

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= dates.length) {
      return;
    }
    const next = dates[nextIndex];
    buttonRefs.current[next.apiDate]?.focus();
    onSelect(next.apiDate);
  };

  return (
    <div
      role="group"
      aria-label="Departure date"
      data-testid="run-selector"
      className="overflow-x-auto rounded-xl border border-card-border bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex gap-1">
        {dates.map((date, index) => {
          const isSelected = date.isSelected === true;
          return (
            <Button
              key={date.apiDate}
              ref={(node) => {
                buttonRefs.current[date.apiDate] = node;
              }}
              variant={isSelected ? "secondary" : "ghost"}
              size="md"
              aria-pressed={isSelected}
              tabIndex={index === tabbableIndex ? 0 : -1}
              title={date.iso}
              data-testid={`tab-date-${date.apiDate}`}
              onClick={() => onSelect(date.apiDate)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={cn(
                "min-w-[88px] flex-1 flex-col gap-1 rounded-lg px-3 py-2 text-center",
                isSelected && "bg-primary text-primary-foreground",
              )}
            >
              <span>{date.label}</span>
              {date.isDefault && !isSelected && (
                <Pill variant="neutral" size="sm">
                  Recommended
                </Pill>
              )}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Search, X } from "lucide-react";
import type { TrainEntry } from "@workspace/trains-data";
import { findTrainByNumber, normalizeTrainNumber } from "@workspace/trains-data";
import { useRecentSearches } from "@/hooks/use-recent-searches";
import { useTrainCatalog } from "@/hooks/use-train-catalog";
import { LiveRegion } from "@/components/primitives";
import { cn } from "@/lib/utils";
import type { TrainValidationState } from "@/lib/validation";
import { buildSuggestions, submitSearch, validationPhase } from "./search-slice";
import type { SuggestionItem } from "./search-slice";
import { RecentTrains } from "./recent-trains";

export interface SearchBoxProps {
  value: string;
  onValueChange: (value: string) => void;
  onValidityChange: (state: TrainValidationState) => void;
  onSelectedChange: (train: TrainEntry | null) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
  "data-testid"?: string;
}

function renderHighlight(text: string, pairs: number[]): ReactNode {
  if (pairs.length < 2) return text;
  const [start, end] = pairs;
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-transparent text-primary">
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

export function SearchBox({
  value,
  onValueChange,
  onValidityChange,
  onSelectedChange,
  onSubmit,
  autoFocus = false,
  "data-testid": testId,
}: SearchBoxProps) {
  const { recent, addRecent } = useRecentSearches();
  const { trains } = useTrainCatalog();

  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [lastValidatedOnBlur, setLastValidatedOnBlur] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const recentNumbers = useMemo(
    () => recent.map((train) => train.number),
    [recent],
  );

  const suggestions = useMemo(
    () => buildSuggestions(value, trains, recentNumbers),
    [value, trains, recentNumbers],
  );

  const recentsOnly =
    suggestions.length > 0 && suggestions[0].type === "recent";
  const recentItems = useMemo(
    () => (recentsOnly ? suggestions : []),
    [recentsOnly, suggestions],
  );

  const open = focused && !dismissed && suggestions.length > 0;

  const phase = useMemo(
    () =>
      validationPhase(
        { value, lastValidatedOnBlur, phase: "idle" },
        { trains },
      ),
    [value, lastValidatedOnBlur, trains],
  );

  const validityState = useMemo<TrainValidationState>(() => {
    if (phase === "valid") return { status: "valid", message: "Valid" };
    if (phase === "invalid") {
      const result = submitSearch(value, trains);
      return {
        status: "invalid",
        message:
          !result.ok && result.reason === "format"
            ? "Train number must be 5 digits."
            : "No train found. Try a different number or name.",
      };
    }
    return { status: "idle" };
  }, [phase, value, trains]);

  useEffect(() => {
    onValidityChange(validityState);
  }, [validityState, onValidityChange]);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const list = listRef.current;
    if (highlightedIndex < 0 || !list) return;
    list
      .querySelector(`[data-option-index="${highlightedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, suggestions]);

  const handleValueChange = (next: string) => {
    onValueChange(next);
    onSelectedChange(null);
    setLastValidatedOnBlur(false);
    setHighlightedIndex(-1);
    setDismissed(false);
  };

  const handleSelect = useCallback(
    (item: SuggestionItem) => {
      const train = findTrainByNumber(trains, item.trainNumber);
      if (!train) return;
      onValueChange(normalizeTrainNumber(train.number));
      addRecent(train);
      onSelectedChange(train);
      setHighlightedIndex(-1);
      setDismissed(true);
      setLastValidatedOnBlur(false);
    },
    [trains, onValueChange, addRecent, onSelectedChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setHighlightedIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlightedIndex((i) =>
        i <= 0 ? suggestions.length - 1 : i - 1,
      );
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlightedIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlightedIndex(suggestions.length - 1);
    } else if (e.key === "Enter") {
      if (open && highlightedIndex >= 0) {
        e.preventDefault();
        handleSelect(suggestions[highlightedIndex]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setDismissed(true);
      setHighlightedIndex(-1);
    }
  };

  const handleFocus = () => {
    setFocused(true);
    setDismissed(false);
  };

  const handleBlur = () => {
    setFocused(false);
    setHighlightedIndex(-1);
    setLastValidatedOnBlur(true);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const result = submitSearch(value, trains);
    if (result.ok) {
      setLastValidatedOnBlur(true);
      onSubmit();
      return;
    }
    setLastValidatedOnBlur(true);
    inputRef.current?.focus();
  };

  const activeOptionId = open
    ? (suggestions[highlightedIndex]?.id ?? null)
    : null;

  const catalogCount = suggestions.filter(
    (item) => item.type === "catalog",
  ).length;
  const recentCount = suggestions.length - catalogCount;
  const countLabel =
    recentCount > 0 && catalogCount === 0
      ? `${recentCount} ${recentCount === 1 ? "recent train" : "recent trains"}`
      : `${suggestions.length} ${
          suggestions.length === 1 ? "suggestion" : "suggestions"
        }`;

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      data-testid={testId ?? "search-form"}
      className="space-y-2"
    >
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          data-testid="input-train-icon"
        />
        <input
          id="trainNo"
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          role="combobox"
          aria-expanded={open}
          aria-controls="train-suggestions"
          aria-activedescendant={activeOptionId ?? undefined}
          aria-autocomplete="list"
          aria-invalid={phase === "invalid" ? true : undefined}
          placeholder="Train number or name"
          autoComplete="off"
          spellCheck={false}
          required
          className="h-12 w-full rounded-xl border border-input bg-card px-4 pl-10 pr-16 font-mono text-lg tracking-wider text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="input-train-number"
        />
        <span className="pointer-events-none absolute end-11 top-1/2 -translate-y-1/2">
          {phase === "valid" ? (
            <CheckCircle2
              className="h-4 w-4 text-success"
              data-testid="status-valid"
              aria-label="Valid"
            />
          ) : phase === "invalid" ? (
            <AlertTriangle
              className="h-4 w-4 text-destructive"
              data-testid="status-invalid"
              aria-label="Invalid"
            />
          ) : null}
        </span>

        {value !== "" && (
          <button
            type="button"
            aria-label="Clear train number"
            data-testid="clear-train-number"
            onClick={() => handleValueChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}

        {open && (
          <ul
            id="train-suggestions"
            role="listbox"
            ref={listRef}
            className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-64 overflow-auto rounded-xl border border-border bg-popover shadow-sm"
            data-testid="list-train-suggestions"
          >
            {recentsOnly ? (
              <RecentTrains
                items={recentItems}
                startIndex={0}
                highlightedIndex={highlightedIndex}
                onSelect={handleSelect}
              />
            ) : (
              suggestions.map((item, index) => (
                <li
                  key={item.id}
                  data-option-index={index}
                  id={item.id}
                  role="option"
                  aria-selected={index === highlightedIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelect(item)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5",
                    index === highlightedIndex && "bg-muted",
                  )}
                >
                  <span className="shrink-0 font-mono text-sm font-bold tracking-wider">
                    {renderHighlight(item.trainNumber, item.highlight.number)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-start text-xs text-muted-foreground">
                    {renderHighlight(item.trainName, item.highlight.name)}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}

        {open && suggestions.length > 0 && (
          <LiveRegion>
            <span data-testid="search-results-count">{countLabel}</span>
          </LiveRegion>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          data-testid="submit-train-search"
          aria-label="Search"
          className="inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-primary px-6 font-sans text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-80"
        >
          <Search className="h-5 w-5" />
          <span>Search</span>
        </button>
        <p className="min-w-0 text-sm text-muted-foreground">
          Enter a train number or name to trace today's status.
        </p>
      </div>

      {phase === "invalid" && (
        <p
          role="alert"
          className="font-mono text-xs uppercase tracking-widest text-destructive"
          data-testid="error-train-number"
        >
          {validityState.message}
        </p>
      )}
      {phase === "valid" && (
        <p
          className="font-mono text-xs uppercase tracking-widest text-success"
          data-testid="valid-train-number"
        >
          Valid
        </p>
      )}
    </form>
  );
}

import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle2, Search, X } from "lucide-react";
import type { TrainEntry } from "@workspace/trains-data";
import { useTrainAutocomplete } from "../hooks/use-train-autocomplete";
import type { AutocompleteOption } from "../hooks/use-train-autocomplete";
import { useTrainCatalog } from "../hooks/use-train-catalog";
import { useRecentSearches } from "../hooks/use-recent-searches";
import { splitHighlight } from "../lib/validation";
import type { TrainValidationState } from "../lib/validation";
import { cn } from "../lib/utils";

export interface SearchBoxProps {
  value: string;
  onValueChange: (value: string) => void;
  onValidityChange: (state: TrainValidationState) => void;
  onSelectedChange: (train: TrainEntry | null) => void;
  onSubmit: () => void;
  autoFocus?: boolean;
  "data-testid"?: string;
}

/**
 * The search deep module: autocomplete, validation, and submit in one box.
 * It reports the raw input (`value`), the resolved suggestion (`selected`),
 * the validation state, and fires `onSubmit` when the user commits.
 */
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

  const handleValueChange = (next: string) => {
    onValueChange(next);
    onSelectedChange(null);
  };

  const {
    onValueChange: handleValueChangeCb,
    options,
    status,
    open,
    highlightedIndex,
    activeOptionId,
    listRef,
    select,
    handleKeyDown,
    handleFocus,
    handleBlur,
  } = useTrainAutocomplete(value, handleValueChange, recent, trains);

  useEffect(() => {
    onValidityChange(status);
  }, [status, onValidityChange]);

  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const input = formRef.current?.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    input?.focus();
  }, [autoFocus]);

  const handleSelect = (option: AutocompleteOption) => {
    select(option);
    addRecent(option.train);
    onSelectedChange(option.train);
  };

  const isValid = status.status === "valid";
  const showError = status.status === "invalid" && !!status.message;

  return (
    <form
      role="search"
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (isValid) onSubmit();
      }}
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
          type="text"
          value={value}
          onChange={(e) => handleValueChangeCb(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          role="combobox"
          aria-expanded={open}
          aria-controls="train-suggestions"
          aria-activedescendant={open ? (activeOptionId ?? undefined) : undefined}
          aria-autocomplete="list"
          aria-invalid={showError ? true : undefined}
          placeholder="Train number or name"
          autoComplete="off"
          spellCheck={false}
          required
          className="h-12 w-full rounded-xl border border-input bg-card px-4 pl-10 pr-16 font-mono text-lg tracking-wider text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="input-train-number"
        />
        <span className="pointer-events-none absolute end-11 top-1/2 -translate-y-1/2">
          {isValid ? (
            <CheckCircle2
              className="h-4 w-4 text-success"
              data-testid="status-valid"
              aria-label="Valid"
            />
          ) : showError ? (
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
            onClick={() => handleValueChangeCb("")}
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
            {options.map((option, index) => (
              <li
                key={option.train.number}
                data-option-index={index}
                id={option.id}
                role="option"
                aria-selected={index === highlightedIndex}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(option)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5",
                  index === highlightedIndex && "bg-muted",
                )}
              >
                <span className="shrink-0 font-mono text-sm font-bold tracking-wider">
                  {splitHighlight(option.train.number, value).map((part, i) =>
                    part.highlight ? (
                      <span key={i} className="text-primary">
                        {part.text}
                      </span>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-start text-xs text-muted-foreground">
                  {splitHighlight(option.train.name, value).map((part, i) =>
                    part.highlight ? (
                      <span key={i} className="text-primary">
                        {part.text}
                      </span>
                    ) : (
                      <span key={i}>{part.text}</span>
                    ),
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          data-testid="submit-train-search"
          aria-disabled={!isValid}
          aria-label="Search"
          className={cn(
            "inline-flex h-12 shrink-0 items-center gap-2 rounded-xl bg-primary px-6 font-sans text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-80",
            !isValid && "opacity-50",
          )}
        >
          <Search className="h-5 w-5" />
          <span>Search</span>
        </button>
        <p className="min-w-0 text-sm text-muted-foreground">
          Enter a train number or name to trace today's status.
        </p>
      </div>

      {showError && (
        <p
          role="alert"
          className="font-mono text-xs uppercase tracking-widest text-destructive"
          data-testid="error-train-number"
        >
          {status.message}
        </p>
      )}
      {isValid && (
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

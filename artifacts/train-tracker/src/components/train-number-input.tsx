import { useCallback, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Clock, TrainFront } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { Key } from "../lib/i18n";
import type { TrainEntry } from "@workspace/trains-data";
import { splitHighlight } from "../lib/validation";
import { cn } from "../lib/utils";
import { Input } from "./ui";
import { useTrainAutocomplete } from "../hooks/use-train-autocomplete";
import type { AutocompleteOption } from "../hooks/use-train-autocomplete";
import { useRecentSearches } from "../hooks/use-recent-searches";
import { useTrainCatalog } from "../hooks/use-train-catalog";
import type { TrainValidationState } from "../lib/validation";

export interface TrainNumberInputProps {
  value: string;
  onValueChange: (value: string) => void;
  onValidityChange?: (state: TrainValidationState) => void;
  onSelectedChange?: (train: TrainEntry | null) => void;
  id?: string;
  compact?: boolean;
  "data-testid"?: string;
}

export function TrainNumberInput({
  value,
  onValueChange,
  onValidityChange,
  onSelectedChange,
  id,
  compact = false,
  "data-testid": testId,
}: TrainNumberInputProps) {
  const { t } = useI18n();
  const { recent, addRecent } = useRecentSearches();
  const { trains } = useTrainCatalog();

  const handleValueChange = useCallback(
    (next: string) => {
      onValueChange(next);
      onSelectedChange?.(null);
    },
    [onValueChange, onSelectedChange],
  );

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
    onValidityChange?.(status);
  }, [status, onValidityChange]);

  const handleSelect = (option: AutocompleteOption) => {
    select(option);
    addRecent(option.train);
    onSelectedChange?.(option.train);
  };

  const showRecent = options.some((option) => option.kind === "recent");
  const showError = status.status === "invalid" && status.message;
  const showValid = status.status === "valid";

  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          type="text"
          value={value}
          onChange={(e) => handleValueChangeCb(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          role="combobox"
          aria-expanded={open}
          aria-controls="train-suggestions"
          aria-activedescendant={
            open ? (activeOptionId ?? undefined) : undefined
          }
          aria-autocomplete="list"
          aria-invalid={showError ? true : undefined}
          placeholder={t("placeholder.trainNumber")}
          autoComplete="off"
          spellCheck={false}
          required
          className="font-mono text-xl h-14 bg-card border-border focus-visible:ring-primary uppercase tracking-widest pe-12 ps-11"
          data-testid={testId ?? "input-train-number"}
        />
        <span className="absolute start-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
          <TrainFront className="w-5 h-5" data-testid="input-train-icon" />
        </span>
        <span className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {showValid ? (
            <CheckCircle2
              className="text-success"
              data-testid="status-valid"
              aria-label={t("hint.valid")}
            />
          ) : showError ? (
            <AlertTriangle
              className="text-destructive"
              data-testid="status-invalid"
              aria-label={t("hint.invalid")}
            />
          ) : null}
        </span>

        {open && (
          <ul
            id="train-suggestions"
            role="listbox"
            ref={listRef}
            className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-64 overflow-auto overscroll-contain [scrollbar-gutter:stable] rounded-xl border border-card-border bg-popover shadow-sm animate-fade-up"
            data-testid="list-train-suggestions"
          >
            {showRecent && (
              <li
                role="presentation"
                className="px-4 pb-1 pt-2 font-mono text-xs uppercase tracking-widest text-muted-foreground flex items-center gap-1.5"
              >
                <Clock className="w-3 h-3" /> {t("label.recent")}
              </li>
            )}
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
                  "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-primary/10",
                  index === highlightedIndex && "bg-primary/10",
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

      {!compact && showError && (
        <p
          role="alert"
          className="mt-1.5 font-mono text-xs uppercase tracking-widest text-destructive"
          data-testid="error-train-number"
        >
          {t(status.message as Key)}
        </p>
      )}
      {!compact && showValid && (
        <p
          className="mt-1.5 font-mono text-xs uppercase tracking-widest text-success"
          data-testid="valid-train-number"
        >
          {t("hint.valid")}
        </p>
      )}
    </div>
  );
}

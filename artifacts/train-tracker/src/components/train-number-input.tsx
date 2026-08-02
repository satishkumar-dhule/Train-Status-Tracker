import { useEffect } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Key } from "@/lib/i18n";
import { splitHighlight } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Input, Spinner } from "@/components/ui";
import { useTrainAutocomplete } from "@/hooks/use-train-autocomplete";
import type { TrainValidationState } from "@/lib/validation";

export interface TrainNumberInputProps {
  value: string;
  onValueChange: (value: string) => void;
  onValidityChange?: (state: TrainValidationState) => void;
  id?: string;
  "data-testid"?: string;
}

export function TrainNumberInput({
  value,
  onValueChange,
  onValidityChange,
  id,
  "data-testid": testId,
}: TrainNumberInputProps) {
  const { t } = useI18n();
  const { suggestions, status, open, highlightedIndex, select, close, handleKeyDown, handleFocus } =
    useTrainAutocomplete(value, onValueChange);

  useEffect(() => {
    onValidityChange?.(status);
  }, [status, onValidityChange]);

  const showError = status.status === "invalid" && status.message;
  const showValid = status.status === "valid";

  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          type="text"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={close}
          role="combobox"
          aria-expanded={open}
          aria-controls="train-suggestions"
          aria-invalid={showError ? true : undefined}
          placeholder={t("placeholder.trainNumber")}
          autoComplete="off"
          spellCheck={false}
          inputMode="numeric"
          required
          className="font-mono text-xl h-14 bg-background border-border focus-visible:ring-primary uppercase tracking-widest pe-12"
          data-testid={testId ?? "input-train-number"}
        />
        <span className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none">
          {status.status === "checking" ? (
            <Spinner className="text-muted-foreground" />
          ) : showValid ? (
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
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-auto rounded-md border border-input bg-popover shadow-md"
            data-testid="list-train-suggestions"
          >
            {suggestions.length === 0 ? (
              <li className="px-4 py-3 font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {t("hint.validating")}
              </li>
            ) : (
              suggestions.map((suggestion, index) => (
                <li
                  key={suggestion.number}
                  role="option"
                  aria-selected={index === highlightedIndex}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(suggestion)}
                  className={cn(
                    "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5",
                    index === highlightedIndex && "bg-accent",
                  )}
                >
                  <span className="font-mono text-sm font-bold tracking-wider">
                    {splitHighlight(suggestion.number, value).map((part, i) =>
                      part.highlight ? (
                        <span key={i} className="text-primary">
                          {part.text}
                        </span>
                      ) : (
                        <span key={i}>{part.text}</span>
                      ),
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {suggestion.name}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {showError && (
        <p
          role="alert"
          className="mt-1.5 font-mono text-xs uppercase tracking-widest text-destructive"
          data-testid="error-train-number"
        >
          {t(status.message as Key)}
        </p>
      )}
      {showValid && (
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

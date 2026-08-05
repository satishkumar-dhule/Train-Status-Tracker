import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "../lib/i18n";
import type { TrainEntry } from "@workspace/trains-data";
import type { TrainValidationState } from "../lib/validation";
import { cn } from "../lib/utils";
import { Button } from "./ui";
import { TrainNumberInput } from "./train-number-input";

export interface SearchFormProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onValidityChange?: (state: TrainValidationState) => void;
  onSelectedChange?: (train: TrainEntry | null) => void;
  compact?: boolean;
  id?: string;
  autoFocus?: boolean;
  "data-testid"?: string;
}

export function SearchForm({
  value,
  onValueChange,
  onSubmit,
  onValidityChange,
  onSelectedChange,
  compact = false,
  id,
  autoFocus = false,
  "data-testid": testId,
}: SearchFormProps) {
  const { t } = useI18n();
  const formRef = useRef<HTMLFormElement>(null);
  const validityRef = useRef<TrainValidationState>({ status: "idle" });
  const [validity, setValidity] = useState<TrainValidationState>({
    status: "idle",
  });

  const handleValidityChange = useCallback(
    (state: TrainValidationState) => {
      validityRef.current = state;
      setValidity(state);
      onValidityChange?.(state);
    },
    [onValidityChange],
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (validityRef.current.status === "valid") {
      onSubmit();
    }
  };

  useEffect(() => {
    if (!autoFocus) return;
    const input = formRef.current?.querySelector<HTMLInputElement>(
      'input[role="combobox"]',
    );
    input?.focus();
  }, [autoFocus]);

  const isValid = validity.status === "valid";

  return (
    <form
      role="search"
      ref={formRef}
      onSubmit={handleSubmit}
      data-testid={testId ?? "search-form"}
      data-compact={compact ? "true" : undefined}
      className={cn("flex gap-2", compact ? "items-center" : "items-start")}
    >
      <div
        className={cn(
          "min-w-0 flex-1",
          compact && "[&_input]:h-10 [&_input]:text-sm",
        )}
      >
        <TrainNumberInput
          id={id}
          value={value}
          onValueChange={onValueChange}
          onValidityChange={handleValidityChange}
          onSelectedChange={onSelectedChange}
          compact={compact}
        />
      </div>
      <Button
        type="submit"
        data-testid="submit-train-search"
        aria-disabled={!isValid}
        aria-label={t("action.search")}
        className={cn(
          "shrink-0 self-stretch",
          compact ? "h-10 px-4" : "h-14 px-5",
          !isValid && "opacity-50 cursor-not-allowed",
        )}
      >
        <Search className={compact ? "w-4 h-4" : "w-5 h-5"} />
        <span className="sr-only">{t("action.search")}</span>
      </Button>
    </form>
  );
}

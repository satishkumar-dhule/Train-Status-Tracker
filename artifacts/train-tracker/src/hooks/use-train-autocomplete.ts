import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MIN_QUERY_LENGTH,
  TRAINS,
  normalizeTrainNumber,
  searchTrains,
  uniqueByNumber,
} from "@workspace/trains-data";
import type { TrainEntry } from "@workspace/trains-data";
import { validateTrainQuery } from "../lib/validation";
import type { TrainValidationState } from "../lib/validation";
export interface AutocompleteOption {
  id: string;
  kind: "recent" | "suggestion";
  train: TrainEntry;
}

export interface TrainAutocompleteApi {
  value: string;
  onValueChange: (value: string) => void;
  options: AutocompleteOption[];
  status: TrainValidationState;
  open: boolean;
  highlightedIndex: number;
  activeOptionId: string | null;
  listRef: React.RefObject<HTMLUListElement | null>;
  select: (option: AutocompleteOption) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleFocus: () => void;
  handleBlur: () => void;
  close: () => void;
}

/** Autocomplete state machine for the train-number input: merged recents + suggestions, keyboard navigation, and ARIA active-descendant support. */
export function useTrainAutocomplete(
  value: string,
  onValueChange: (value: string) => void,
  recent: TrainEntry[],
  trains: TrainEntry[] = TRAINS,
): TrainAutocompleteApi {
  const [selected, setSelected] = useState<TrainEntry | null>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const listRef = useRef<HTMLUListElement | null>(null);

  const normalized = normalizeTrainNumber(value);

  const options = useMemo(() => {
    const suggestionTrains =
      normalized.length >= MIN_QUERY_LENGTH
        ? searchTrains(normalized, 10, trains)
        : [];
    const merged = uniqueByNumber([...recent, ...suggestionTrains]);
    if (merged.length === 0) return [];
    const recentNumbers = new Set(recent.map((train) => train.number));
    return merged.map<AutocompleteOption>((train) => ({
      id: `train-opt-${train.number}`,
      kind: recentNumbers.has(train.number) ? "recent" : "suggestion",
      train,
    }));
  }, [recent, normalized, trains]);

  const status = useMemo(
    () => validateTrainQuery(value, selected, trains),
    [value, selected, trains],
  );

  const onValueChangeCb = useCallback(
    (next: string) => {
      onValueChange(next);
      setSelected(null);
      setHighlightedIndex(-1);
      setDismissed(false);
    },
    [onValueChange],
  );

  const close = useCallback(() => {
    setDismissed(true);
    setHighlightedIndex(-1);
  }, []);

  const select = useCallback(
    (option: AutocompleteOption) => {
      onValueChange(normalizeTrainNumber(option.train.number));
      setSelected(option.train);
      setHighlightedIndex(-1);
      close();
    },
    [onValueChange, close],
  );

  const open = focused && !dismissed && options.length > 0;

  const handleFocus = useCallback(() => {
    setFocused(true);
    setDismissed(false);
  }, []);

  const handleBlur = useCallback(() => {
    setFocused(false);
    setHighlightedIndex(-1);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (options.length === 0) return;
        setHighlightedIndex((i) => (i + 1) % options.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
      } else if (e.key === "Home") {
        setHighlightedIndex(0);
      } else if (e.key === "End") {
        setHighlightedIndex(options.length - 1);
      } else if (e.key === "Enter") {
        if (open && highlightedIndex >= 0) {
          e.preventDefault();
          select(options[highlightedIndex]);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    },
    [open, highlightedIndex, options, select, close],
  );

  useEffect(() => {
    const list = listRef.current;
    if (highlightedIndex < 0 || !list) return;
    const option = list.querySelector(
      `[data-option-index="${highlightedIndex}"]`,
    );
    option?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex, options]);

  return {
    value,
    onValueChange: onValueChangeCb,
    options,
    status,
    open,
    highlightedIndex,
    activeOptionId: options[highlightedIndex]?.id ?? null,
    listRef,
    select,
    handleKeyDown,
    handleFocus,
    handleBlur,
    close,
  };
}

import { useCallback, useMemo, useRef, useState } from "react";
import {
  getSearchTrainsQueryKey,
  useSearchTrains,
} from "@workspace/api-client-react";
import type { TrainSuggestion } from "@workspace/api-client-react";
import { useDebouncedValue } from "./use-debounce";
import {
  MIN_QUERY_LENGTH,
  isValidTrainNumberFormat,
  normalizeTrainNumber,
  validateTrain,
} from "../lib/validation";
import type { TrainValidationState } from "../lib/validation";

const DEBOUNCE_MS = 300;

export interface TrainAutocompleteApi {
  value: string;
  onValueChange: (value: string) => void;
  suggestions: TrainSuggestion[];
  status: TrainValidationState;
  open: boolean;
  highlightedIndex: number;
  select: (suggestion: TrainSuggestion) => void;
  close: () => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleFocus: () => void;
}

export function useTrainAutocomplete(
  value: string,
  onValueChange: (value: string) => void,
): TrainAutocompleteApi {
  const [selected, setSelected] = useState<TrainSuggestion | null>(null);
  const [focused, setFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);

  const normalized = normalizeTrainNumber(value);
  const debounced = useDebouncedValue(normalized, DEBOUNCE_MS);

  const formatOk = isValidTrainNumberFormat(debounced);
  const enabled = debounced.length >= MIN_QUERY_LENGTH && formatOk;

  const { data, isFetching, isError } = useSearchTrains(
    { q: debounced },
    {
      query: {
        enabled,
        queryKey: getSearchTrainsQueryKey({ q: debounced }),
        staleTime: 60_000,
        placeholderData: (prev) => prev,
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  );

  const suggestions = useMemo(
    () => (enabled && data && !isFetching ? (data.results ?? []) : []),
    [data, enabled, isFetching],
  );

  const fetchState = !enabled
    ? "idle"
    : isFetching
      ? "fetching"
      : isError
        ? "error"
        : "success";

  const status = useMemo(
    () => validateTrain(value, selected, suggestions, fetchState),
    [value, selected, suggestions, fetchState],
  );

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const valueRef = useRef(value);
  valueRef.current = value;

  const onValueChangeCb = useCallback(
    (next: string) => {
      onValueChange(next);
      setSelected(null);
      setHighlightedIndex(-1);
    },
    [onValueChange],
  );

  const select = useCallback(
    (suggestion: TrainSuggestion) => {
      const next = normalizeTrainNumber(suggestion.number);
      onValueChange(next);
      setSelected(suggestion);
      setHighlightedIndex(-1);
    },
    [onValueChange],
  );

  const close = useCallback(() => {
    setHighlightedIndex(-1);
  }, []);

  const open =
    focused && (suggestions.length > 0 || (enabled && isFetching) || isError);

  const handleFocus = useCallback(() => setFocused(true), []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          suggestions.length === 0 ? -1 : (prev + 1) % suggestions.length,
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          suggestions.length === 0
            ? -1
            : (prev - 1 + suggestions.length) % suggestions.length,
        );
      } else if (e.key === "Enter") {
        if (
          open &&
          highlightedIndex >= 0 &&
          highlightedIndex < suggestions.length
        ) {
          e.preventDefault();
          select(suggestions[highlightedIndex]);
        }
      } else if (e.key === "Escape") {
        setHighlightedIndex(-1);
      }
    },
    [open, highlightedIndex, suggestions, select],
  );

  return {
    value,
    onValueChange: onValueChangeCb,
    suggestions,
    status,
    open,
    highlightedIndex,
    select,
    close,
    handleKeyDown,
    handleFocus,
  };
}

export type { TrainSuggestion };

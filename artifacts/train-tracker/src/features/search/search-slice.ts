import {
  MIN_QUERY_LENGTH,
  TRAINS,
  findTrainByNumber,
  normalizeTrainNumber,
  searchTrains,
} from "@workspace/trains-data";
import type { TrainEntry } from "@workspace/trains-data";
import { isValidTrainNumberFormat, splitHighlight } from "@/lib/validation";

export interface SuggestionItem {
  id: string;
  trainNumber: string;
  trainName: string;
  type: "catalog" | "recent";
  highlight: { number: number[]; name: number[] };
}

const RECENT_LIMIT = 5;
const SUGGESTION_LIMIT = 6;

function highlightPairs(text: string, query: string): number[] {
  const parts = splitHighlight(text, query);
  const pairs: number[] = [];
  let offset = 0;
  for (const part of parts) {
    if (part.highlight) pairs.push(offset, offset + part.text.length);
    offset += part.text.length;
  }
  return pairs;
}

export function buildSuggestions(
  value: string,
  trains: TrainEntry[],
  recents: string[],
): SuggestionItem[] {
  if (value.trim().length < MIN_QUERY_LENGTH) {
    const items: SuggestionItem[] = [];
    for (const number of recents) {
      if (items.length >= RECENT_LIMIT) break;
      const train = findTrainByNumber(trains, number);
      if (!train) continue;
      items.push({
        id: `recent-${train.number}`,
        trainNumber: train.number,
        trainName: train.name,
        type: "recent",
        highlight: { number: [], name: [] },
      });
    }
    return items;
  }
  return searchTrains(value, SUGGESTION_LIMIT, trains).map((train) => ({
    id: `suggest-${train.number}`,
    trainNumber: train.number,
    trainName: train.name,
    type: "catalog",
    highlight: {
      number: highlightPairs(train.number, value),
      name: highlightPairs(train.name, value),
    },
  }));
}

export type ValidationPhase = "idle" | "typing" | "valid" | "invalid";

export interface ValidationTiming {
  value: string;
  lastValidatedOnBlur: boolean;
  phase: ValidationPhase;
}

export function validationPhase(
  timing: ValidationTiming,
  options: {
    minQueryLength?: number;
    isValidFormat?: (value: string) => boolean;
    hasMatch?: (value: string) => boolean;
    trains?: TrainEntry[];
  } = {},
): ValidationPhase {
  const minQueryLength = options.minQueryLength ?? MIN_QUERY_LENGTH;
  const isValidFormat = options.isValidFormat ?? isValidTrainNumberFormat;
  const hasMatch =
    options.hasMatch ??
    ((value: string) =>
      findTrainByNumber(options.trains ?? TRAINS, normalizeTrainNumber(value)) !==
      null);
  const normalized = normalizeTrainNumber(timing.value);

  if (timing.value.trim().length < minQueryLength) return "idle";
  if (!timing.lastValidatedOnBlur) return "typing";
  return isValidFormat(normalized) && hasMatch(normalized)
    ? "valid"
    : "invalid";
}

export type SubmitResult = { ok: true } | { ok: false; reason: "format" | "not-found" };

export function submitSearch(
  value: string,
  trains: TrainEntry[],
  options?: { normalize?: (value: string) => string },
): SubmitResult {
  const normalize = options?.normalize ?? normalizeTrainNumber;
  const normalized = normalize(value);
  if (!isValidTrainNumberFormat(normalized)) {
    return { ok: false, reason: "format" };
  }
  if (!findTrainByNumber(trains, normalized)) {
    return { ok: false, reason: "not-found" };
  }
  return { ok: true };
}

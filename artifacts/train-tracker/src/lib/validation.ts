import {
  MIN_QUERY_LENGTH,
  matchesTrainName,
  matchesTrainNumber,
  normalizeTrainNumber,
  uniqueByNumber,
} from "@workspace/trains-data";
import type { TrainEntry } from "@workspace/trains-data";

export const TRAIN_NUMBER_PATTERN = /^\d{5}$/;

export type TrainValidationStatus = "idle" | "valid" | "invalid";

export interface TrainValidationState {
  status: TrainValidationStatus;
  message?: string;
}

/** Client-side format gate: exactly 5 digits. */
export function isValidTrainNumberFormat(value: string): boolean {
  return TRAIN_NUMBER_PATTERN.test(value);
}

function isFullyNumeric(value: string): boolean {
  return /^\d+$/.test(value);
}

/**
 * Client-side validation resolver (zero-trust state machine).
 * `valid` ONLY when the input resolves to a single concrete train — by exact
 * number match, unique full-name match, or a previously picked suggestion.
 * Failure to verify is never treated as valid.
 */
export function validateTrainQuery(
  query: string,
  selected: TrainEntry | null,
  trains: TrainEntry[],
): TrainValidationState {
  const normalized = normalizeTrainNumber(query);

  if (!normalized || normalized.length < MIN_QUERY_LENGTH) {
    return { status: "idle" };
  }

  if (selected && matchesTrainNumber(selected.number, normalized)) {
    return { status: "valid", message: "Valid" };
  }

  const candidates = uniqueByNumber(trains);

  const numberMatches = candidates.filter((train) =>
    matchesTrainNumber(train.number, normalized),
  );
  if (numberMatches.length === 1) {
    return { status: "valid", message: "Valid" };
  }

  const nameMatches = candidates.filter((train) =>
    matchesTrainName(train.name, normalized),
  );
  if (nameMatches.length === 1) {
    return { status: "valid", message: "Valid" };
  }

  if (
    candidates.some(
      (train) =>
        train.number.startsWith(normalized) ||
        normalizeTrainNumber(train.name).includes(normalized),
    )
  ) {
    return { status: "invalid", message: "Select a train from the list to continue." };
  }

  if (isFullyNumeric(normalized) && !isValidTrainNumberFormat(normalized)) {
    return { status: "invalid", message: "Train number must be 5 digits." };
  }

  return { status: "invalid", message: "No train found. Try a different number or name." };
}

/**
 * Single resolution used for auto-submit and recent-chip clicks: selected
 * train first, then unique exact-number match, then unique full-name match.
 */
export function resolveTrain(
  query: string,
  selected: { number: string; name: string } | null,
  trains: { number: string; name: string }[],
): { number: string; name: string } | null {
  const normalized = normalizeTrainNumber(query);
  if (!normalized) return null;

  if (selected && matchesTrainNumber(selected.number, normalized)) {
    return selected;
  }

  const unique = uniqueByNumber(trains);

  const numberMatches = unique.filter((train) =>
    matchesTrainNumber(train.number, normalized),
  );
  if (numberMatches.length === 1) return numberMatches[0];

  const nameMatches = unique.filter((train) =>
    matchesTrainName(train.name, normalized),
  );
  if (nameMatches.length === 1) return nameMatches[0];

  return null;
}

/** [{ text: "22", highlight: true }, { text: "943", highlight: false }] */
export function splitHighlight(
  text: string,
  query: string,
): Array<{ text: string; highlight: boolean }> {
  const q = normalizeTrainNumber(query);
  if (!q) return [{ text, highlight: false }];

  const stripped = text.toUpperCase().replace(/\s+/g, "");
  const index = stripped.indexOf(q);
  if (index === -1) return [{ text, highlight: false }];

  // Map the match index in the space-stripped string back to the raw text.
  let start = 0;
  let skipped = 0;
  while (skipped < index) {
    if (!/\s/.test(text[start])) skipped++;
    start++;
  }
  let end = start;
  let matched = 0;
  while (matched < q.length) {
    if (!/\s/.test(text[end])) matched++;
    end++;
  }

  const parts: Array<{ text: string; highlight: boolean }> = [];
  if (start > 0) parts.push({ text: text.slice(0, start), highlight: false });
  parts.push({ text: text.slice(start, end), highlight: true });
  if (end < text.length) parts.push({ text: text.slice(end), highlight: false });
  return parts;
}

import type { TrainSuggestion } from "@workspace/api-client-react";

export const MIN_QUERY_LENGTH = 2;
export const TRAIN_NUMBER_PATTERN = /^\d{5}$/;

export type TrainValidationStatus = "idle" | "checking" | "valid" | "invalid";

export interface TrainValidationState {
  status: TrainValidationStatus;
  message?: string;
}

export type FetchState = "idle" | "fetching" | "error" | "success";

/** " 22943 " -> "22943"; "raj" -> "RAJ" */
export function normalizeTrainNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase().trim();
}

/** Client-side format gate: exactly 5 digits. */
export function isValidTrainNumberFormat(value: string): boolean {
  return TRAIN_NUMBER_PATTERN.test(value);
}

/** Exact number comparison on normalized values. */
export function matchesTrainNumber(
  suggestionNumber: string,
  normalizedInput: string,
): boolean {
  return normalizeTrainNumber(suggestionNumber) === normalizedInput;
}

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear().toString();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 'YYYY-MM-DD' must be a real calendar date and >= today (local). */
export function isValidDepartureDate(dateISO: string, now?: Date): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return false;
  const [y, m, d] = dateISO.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  if (
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    return false;
  }
  const today = now ?? new Date();
  return dateISO >= toLocalDateKey(today);
}

/** '2023-10-15' -> '20231015' */
export function toApiDate(dateISO: string): string {
  return dateISO.replace(/-/g, "");
}

/**
 * Core validation resolver (zero-trust state machine).
 * `valid` ONLY when the normalized input equals a server-returned
 * suggestion number (or a previously picked suggestion that still matches).
 * Failure to verify is never treated as valid.
 */
export function validateTrain(
  query: string,
  selected: TrainSuggestion | null,
  results: TrainSuggestion[],
  fetchState: FetchState,
): TrainValidationState {
  const normalized = normalizeTrainNumber(query);

  if (!normalized) {
    return { status: "idle" };
  }

  if (!isValidTrainNumberFormat(normalized)) {
    return { status: "invalid", message: "hint.invalidFormat" };
  }

  if (selected && matchesTrainNumber(selected.number, normalized)) {
    return { status: "valid", message: "hint.valid" };
  }

  if (fetchState === "fetching") {
    return { status: "checking", message: "hint.validating" };
  }

  if (fetchState === "error") {
    return { status: "invalid", message: "hint.unknownTrain" };
  }

  if (fetchState === "success") {
    const exactMatches = results.filter((s) =>
      matchesTrainNumber(s.number, normalized),
    );
    if (exactMatches.length === 1) {
      return { status: "valid", message: "hint.valid" };
    }
  }

  return { status: "invalid", message: "hint.unknownTrain" };
}

/** [{ text: "22", highlight: true }, { text: "943", highlight: false }] */
export function splitHighlight(
  text: string,
  query: string,
): Array<{ text: string; highlight: boolean }> {
  const q = normalizeTrainNumber(query);
  if (!q) return [{ text, highlight: false }];
  const index = text.toUpperCase().indexOf(q);
  if (index === -1) return [{ text, highlight: false }];
  const parts: Array<{ text: string; highlight: boolean }> = [];
  if (index > 0) parts.push({ text: text.slice(0, index), highlight: false });
  parts.push({
    text: text.slice(index, index + q.length),
    highlight: true,
  });
  if (index + q.length < text.length) {
    parts.push({ text: text.slice(index + q.length), highlight: false });
  }
  return parts;
}

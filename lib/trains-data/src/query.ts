import type { TrainEntry } from "./search";

export const MIN_QUERY_LENGTH = 2;

/** " 22943 " -> "22943"; "raj" -> "RAJ" */
export function normalizeTrainNumber(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase().trim();
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/** Exact number comparison on normalized values. */
export function matchesTrainNumber(
  suggestionNumber: string,
  normalizedInput: string,
): boolean {
  return normalizeTrainNumber(suggestionNumber) === normalizedInput;
}

/** Case/space-insensitive exact name comparison. */
export function matchesTrainName(
  suggestionName: string,
  normalizedInput: string,
): boolean {
  return normalizeName(suggestionName) === normalizeName(normalizedInput);
}

/** First occurrence wins per train number. */
export function uniqueByNumber(trains: TrainEntry[]): TrainEntry[] {
  const seen = new Set<string>();
  const unique: TrainEntry[] = [];
  for (const train of trains) {
    if (seen.has(train.number)) continue;
    seen.add(train.number);
    unique.push(train);
  }
  return unique;
}

/** Find a train by exact normalized number (dedupe-aware). */
export function findTrainByNumber(
  trains: TrainEntry[],
  number: string,
): TrainEntry | null {
  const normalized = normalizeTrainNumber(number);
  for (const train of trains) {
    if (normalizeTrainNumber(train.number) === normalized) return train;
  }
  return null;
}

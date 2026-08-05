import type { TrainEntry } from "@workspace/trains-data";

export const RECENT_SEARCHES_STORAGE_KEY = "terminal-track.recent";

export const DEFAULT_RECENT_LIMIT = 6;

export type RecentStorage = Pick<Storage, "getItem" | "setItem">;

function isTrainEntry(value: unknown): value is TrainEntry {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.number === "string" && typeof record.name === "string";
}

export function loadRecentSearches(
  storage: RecentStorage,
  limit: number = DEFAULT_RECENT_LIMIT,
): TrainEntry[] {
  try {
    const raw = storage.getItem(RECENT_SEARCHES_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrainEntry).slice(0, limit);
  } catch {
    return [];
  }
}

export function saveRecentSearch(
  storage: RecentStorage,
  train: TrainEntry,
  limit: number = DEFAULT_RECENT_LIMIT,
): TrainEntry[] {
  const current = loadRecentSearches(storage, Infinity);
  const next = [
    train,
    ...current.filter((item) => item.number !== train.number),
  ].slice(0, limit);
  try {
    storage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // persist failed — still return the in-memory list
  }
  return next;
}

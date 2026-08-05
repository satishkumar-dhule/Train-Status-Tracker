import * as React from "react";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { TrainEntry } from "@workspace/trains-data";
import {
  DEFAULT_RECENT_LIMIT,
  loadRecentSearches,
  saveRecentSearch,
} from "../lib/recent-searches";
import type { RecentStorage } from "../lib/recent-searches";

export interface RecentSearchesValue {
  recent: TrainEntry[];
  addRecent: (train: TrainEntry) => void;
}

const RecentSearchesContext = createContext<RecentSearchesValue | null>(null);

function getLocalStorage(): RecentStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function RecentSearchesProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [recent, setRecent] = useState<TrainEntry[]>(() => {
    const storage = getLocalStorage();
    return storage ? loadRecentSearches(storage) : [];
  });

  const addRecent = useCallback((train: TrainEntry) => {
    setRecent((current) => {
      const storage = getLocalStorage();
      if (storage) return saveRecentSearch(storage, train);
      return [
        train,
        ...current.filter((item) => item.number !== train.number),
      ].slice(0, DEFAULT_RECENT_LIMIT);
    });
  }, []);

  const value = useMemo(
    () => ({ recent, addRecent }),
    [recent, addRecent],
  );

  return (
    <RecentSearchesContext.Provider value={value}>
      {children}
    </RecentSearchesContext.Provider>
  );
}

export function useRecentSearches(): RecentSearchesValue {
  const context = useContext(RecentSearchesContext);
  if (context === null) {
    throw new Error(
      "useRecentSearches must be used within RecentSearchesProvider",
    );
  }
  return context;
}

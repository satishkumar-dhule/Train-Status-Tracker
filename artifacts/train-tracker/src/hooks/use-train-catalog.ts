import { useEffect, useState } from "react";
import { TRAINS, uniqueByNumber } from "@workspace/trains-data";
import type { TrainEntry } from "@workspace/trains-data";
import { getTrainCatalog } from "@workspace/api-client-react";

/**
 * How long the fetched train catalog is kept in the browser before it is
 * re-pulled from the API (which in turn caches the NTES upstream for 2h).
 */
export const TRAIN_CATALOG_TTL_MS = 2 * 60 * 60 * 1000;

export interface TrainCatalogState {
  /** Train list to drive autocomplete — the fetched catalog, or the bundled fallback. */
  trains: TrainEntry[];
  isLoading: boolean;
  isError: boolean;
}

interface CatalogCache {
  trains: TrainEntry[];
  expiresAt: number;
}

/**
 * Module-level TTL cache: one fetch per tab, shared by every search box,
 * single-flighted so concurrent mounters trigger a single request.
 */
let cache: CatalogCache | null = null;
let inFlight: Promise<TrainEntry[]> | null = null;

function loadTrainCatalog(): Promise<TrainEntry[]> {
  if (cache && cache.expiresAt > Date.now()) {
    return Promise.resolve(cache.trains);
  }
  if (!inFlight) {
    inFlight = getTrainCatalog()
      .then((response) => {
        const trains = uniqueByNumber(response.trains);
        cache = { trains, expiresAt: Date.now() + TRAIN_CATALOG_TTL_MS };
        return trains;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight;
}

/**
 * Returns the NTES train catalog (number + name) bound to the search boxes.
 * Fail-open: while loading or when the API is unreachable the bundled static
 * list is used, so autocomplete always has data to suggest from.
 */
export function useTrainCatalog(): TrainCatalogState {
  const [state, setState] = useState<TrainCatalogState>({
    trains: TRAINS,
    isLoading: true,
    isError: false,
  });

  useEffect(() => {
    let cancelled = false;
    loadTrainCatalog().then(
      (trains) => {
        if (cancelled) return;
        setState({ trains, isLoading: false, isError: false });
      },
      () => {
        if (cancelled) return;
        setState({ trains: TRAINS, isLoading: false, isError: true });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

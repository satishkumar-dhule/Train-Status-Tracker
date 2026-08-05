import {
  TRAIN_DATA_DEFAULT_TTL_MS,
  createTrainDataFetcher,
} from "@workspace/trains-data";
import type { TrainDataFetcher, TrainEntry } from "@workspace/trains-data";
import { logger } from "./logger";

/**
 * Train catalog configuration. The NTES train list is fetched once and kept
 * for `TRAIN_CATALOG_TTL_MS` (default 2h). The upstream cache-buster query
 * parameter (`?v=...`) is configurable via `TRAIN_DATA_VERSION` so operators
 * can force a refresh without waiting for the TTL to expire.
 */
export const TRAIN_CATALOG_TTL_MS = Number(
  process.env.TRAIN_CATALOG_TTL_MS ?? TRAIN_DATA_DEFAULT_TTL_MS,
);

const TRAIN_DATA_VERSION = process.env.TRAIN_DATA_VERSION;

const fetcher: TrainDataFetcher = createTrainDataFetcher({
  baseUrl: process.env.TRAIN_DATA_URL,
  version: TRAIN_DATA_VERSION,
  ttlMs: TRAIN_CATALOG_TTL_MS,
  onError: (err) => {
    logger.warn(
      { err },
      "Train catalog upstream fetch failed; serving bundled dataset",
    );
  },
});

logger.info(
  { sourceUrl: fetcher.sourceUrl, ttlMs: TRAIN_CATALOG_TTL_MS },
  "Train catalog configured",
);

/** Full train list (fetched from NTES, TTL-cached, fail-open to bundled). */
export function getTrainCatalog(): Promise<TrainEntry[]> {
  return fetcher.getTrains();
}

/** Duck-typed fuzzy search over the fetched catalog. */
export function searchTrainCatalog(
  query: string,
  limit?: number,
): Promise<TrainEntry[]> {
  return fetcher.search(query, limit);
}

import { keepPreviousData } from "@tanstack/react-query";
import {
  getGetTrainStatusQueryKey,
  useGetTrainStatus,
} from "@workspace/api-client-react";
import type { TrainStatusResponse } from "@workspace/api-client-react";
import {
  STATUS_CACHE_GC_BUFFER_MS,
  getStatusCacheTtlMs,
} from "../lib/status-cache";
import { getAutoRefreshIntervalMs } from "../lib/auto-refresh";
import {
  isProviderUnreachableError,
  isTrainNotFoundError,
} from "../lib/status-metrics";

/**
 * Freshness window for cached status payloads (default 5 min). While a
 * payload is younger than this, remounts and refocuses serve from the query
 * cache and never hit the backend API.
 */
const STATUS_CACHE_TTL_MS = getStatusCacheTtlMs();

/** Polling cadence when auto-refresh is ON (default 30s, see lib/auto-refresh). */
const AUTO_REFRESH_INTERVAL_MS = getAutoRefreshIntervalMs();

export interface TrainStatusResult {
  data: TrainStatusResponse | undefined;
  /** True only when there is NO data yet and a fetch is in flight (first load). */
  isLoading: boolean;
  /** True whenever any background refetch is in flight. */
  isFetching: boolean;
  /**
   * True when the shown data is a placeholder (the previous query's data)
   * while a new query — e.g. a different date — is still loading. Placeholder
   * data is NOT the selected date's truth and must not be presented as live.
   */
  isPlaceholderData: boolean;
  isError: boolean;
  isNotFound: boolean;
  isProviderError: boolean;
  isNetworkError: boolean;
  /** i18n key for the error, or null when there is no error. */
  messageKey: string | null;
  /** Forces a fresh fetch of the current train/date, bypassing the cache. */
  refetch: () => Promise<unknown>;
}

export function useTrainStatus(
  params: { train_number: string; departure_date: string } | null,
  enabled?: boolean,
  autoRefresh?: boolean,
): TrainStatusResult {
  const query = useGetTrainStatus(
    params ?? { train_number: "", departure_date: "" },
    {
      query: {
        enabled: !!params && enabled !== false,
        queryKey: params ? getGetTrainStatusQueryKey(params) : [],
        retry: false,
        refetchOnWindowFocus: false,
        refetchInterval: autoRefresh ? AUTO_REFRESH_INTERVAL_MS : undefined,
        staleTime: STATUS_CACHE_TTL_MS,
        gcTime: STATUS_CACHE_TTL_MS + STATUS_CACHE_GC_BUFFER_MS,
        placeholderData: keepPreviousData,
      },
    },
  );

  const { data, isFetching, isError, isPlaceholderData, error, refetch } =
    query;

  const isLoading = data === undefined && isFetching;

  let isNotFound = false;
  let isProviderError = false;
  let isNetworkError = false;
  let messageKey: string | null = null;

  if (isError) {
    if (isTrainNotFoundError(error)) {
      isNotFound = true;
      messageKey = "error.trainNotFound";
    } else if (isProviderUnreachableError(error)) {
      isProviderError = true;
      messageKey = "error.providerUnreachable";
    } else {
      isNetworkError = true;
      messageKey = "error.fallback";
    }
  }

  return {
    data,
    isLoading,
    isFetching,
    isPlaceholderData,
    isError,
    isNotFound,
    isProviderError,
    isNetworkError,
    messageKey,
    refetch,
  };
}

import { keepPreviousData } from "@tanstack/react-query";
import {
  getGetTrainStatusQueryKey,
  useGetTrainStatus,
} from "@workspace/api-client-react";
import type {
  GetTrainStatusProvider,
  TrainStatusResponse,
} from "@workspace/api-client-react";
import {
  STATUS_CACHE_GC_BUFFER_MS,
  getStatusCacheTtlMs,
} from "../lib/status-cache";
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

/** What the status query is asked for. `provider` pins a single gateway. */
export type TrainStatusQueryParams = {
  train_number: string;
  departure_date: string;
  provider?: GetTrainStatusProvider;
};

/** Why a status query failed, when it failed. */
export type TrainStatusErrorType = "not-found" | "provider" | "network";

export interface TrainStatusResult {
  data: TrainStatusResponse | undefined;
  /** True only when there is NO data yet and a fetch is in flight (first load). */
  isLoading: boolean;
  /** True whenever any background refetch is in flight. */
  isFetching: boolean;
  /**
   * True when the shown data is a placeholder (the previous query's data)
   * while a new query is still loading. Placeholder data is NOT the selected
   * date's truth and must not be presented as live.
   */
  isPlaceholderData: boolean;
  isError: boolean;
  /** Why the query failed, or null when there is no error. */
  errorType: TrainStatusErrorType | null;
  /** Forces a fresh fetch of the current train/date, bypassing the cache. */
  refetch: () => Promise<unknown>;
}

export function useTrainStatus(
  params: TrainStatusQueryParams | null,
  enabled?: boolean,
): TrainStatusResult {
  const query = useGetTrainStatus(
    params ?? { train_number: "", departure_date: "" },
    {
      query: {
        enabled: !!params && enabled !== false,
        queryKey: params ? getGetTrainStatusQueryKey(params) : [],
        retry: false,
        refetchOnWindowFocus: false,
        staleTime: STATUS_CACHE_TTL_MS,
        gcTime: STATUS_CACHE_TTL_MS + STATUS_CACHE_GC_BUFFER_MS,
        placeholderData: keepPreviousData,
      },
    },
  );

  const { data, isFetching, isError, isPlaceholderData, error, refetch } =
    query;

  const isLoading = data === undefined && isFetching;

  let errorType: TrainStatusErrorType | null = null;
  if (isError) {
    if (isTrainNotFoundError(error)) {
      errorType = "not-found";
    } else if (isProviderUnreachableError(error)) {
      errorType = "provider";
    } else {
      errorType = "network";
    }
  }

  return {
    data,
    isLoading,
    isFetching,
    isPlaceholderData,
    isError,
    errorType,
    refetch,
  };
}

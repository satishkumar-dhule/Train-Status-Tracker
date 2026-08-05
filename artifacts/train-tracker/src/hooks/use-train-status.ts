import { keepPreviousData } from "@tanstack/react-query";
import {
  getGetTrainStatusQueryKey,
  useGetTrainStatus,
} from "@workspace/api-client-react";
import type { TrainStatusResponse } from "@workspace/api-client-react";
import {
  isProviderUnreachableError,
  isTrainNotFoundError,
} from "../lib/status-metrics";

export interface TrainStatusResult {
  data: TrainStatusResponse | undefined;
  /** True only when there is NO data yet and a fetch is in flight (first load). */
  isLoading: boolean;
  /** True whenever any background refetch is in flight. */
  isFetching: boolean;
  isError: boolean;
  isNotFound: boolean;
  isProviderError: boolean;
  isNetworkError: boolean;
  /** i18n key for the error, or null when there is no error. */
  messageKey: string | null;
}

export function useTrainStatus(
  params: { train_number: string; departure_date: string } | null,
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
        placeholderData: keepPreviousData,
      },
    },
  );

  const { data, isFetching, isError, error } = query;

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
    isError,
    isNotFound,
    isProviderError,
    isNetworkError,
    messageKey,
  };
}

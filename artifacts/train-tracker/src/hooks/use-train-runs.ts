import {
  getGetTrainRunsQueryKey,
  useGetTrainRuns,
} from "@workspace/api-client-react";

export interface TrainRunsResult {
  /** Run dates (YYYYMMDD, ascending: last 3 up to today plus the next run). */
  runs: string[] | undefined;
  isLoading: boolean;
  isError: boolean;
}

/**
 * Recent and upcoming run dates for a searched train. Fail-open: `runs` is
 * `undefined` while loading or when the API is unreachable, letting callers
 * fall back to the plain calendar window.
 */
export function useTrainRuns(trainNumber: string | null): TrainRunsResult {
  const query = useGetTrainRuns(
    { train_number: trainNumber ?? "" },
    {
      query: {
        enabled: !!trainNumber,
        queryKey: trainNumber
          ? getGetTrainRunsQueryKey({ train_number: trainNumber })
          : [],
        retry: false,
        refetchOnWindowFocus: false,
      },
    },
  );

  const runs = query.data?.runs;

  return {
    runs,
    isLoading: runs === undefined && query.isFetching,
    isError: query.isError,
  };
}

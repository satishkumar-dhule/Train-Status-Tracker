import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GetTrainStatusProvider,
  TrainStatusResponse,
} from "@workspace/api-client-react";
import {
  formatShortDate,
  fromApiDate,
  getUpcomingDates,
  pickDefaultRunDate,
  toApiDate,
} from "@workspace/trains-data";
import { GATEWAY_AUTO } from "@/components/gateway-selector";
import { useTrainProviders } from "@/hooks/use-train-providers";
import { useTrainRuns } from "@/hooks/use-train-runs";
import { useTrainStatus } from "@/hooks/use-train-status";
import type { TrainStatusQueryParams } from "@/hooks/use-train-status";

export interface RunTab {
  apiDate: string;
  iso: string;
  label: string;
  isDefault?: boolean;
  isSelected?: boolean;
}

export interface JourneySlice {
  selected: { trainNumber: string; departureDate: string } | null;
  runs: string[] | undefined;
  runsError: boolean;
  dates: RunTab[];
  activeDate: string;
  selectDate(apiDate: string): void;
  userPickedDate: boolean;
  gateway: string;
  setGateway(g: string): void;
  gateways: string[];
  status: {
    data: TrainStatusResponse | undefined;
    isLoading: boolean;
    isFetching: boolean;
    isPlaceholderData: boolean;
    isError: boolean;
    errorType: "not-found" | "provider" | "network" | null;
    refetch(): void;
  };
  refresh(): void;
  autoRefresh: {
    enabled: boolean;
    cadenceMs: number;
    setEnabled(enabled: boolean): void;
    setCadence(ms: number): void;
  };
}

const AUTO_REFRESH_CADENCE_MS = 5 * 60_000;

export function useJourney(trainNumber: string | null): JourneySlice {
  const today = useMemo(() => toApiDate(getUpcomingDates(1)[0]), []);
  const [departureDate, setDepartureDate] = useState<string>(today);
  const [userPickedDate, setUserPickedDate] = useState(false);
  const [gateway, setGatewayValue] = useState<string>(GATEWAY_AUTO);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [autoRefreshCadence, setAutoRefreshCadence] = useState(
    AUTO_REFRESH_CADENCE_MS,
  );

  const { runs, isError: runsError } = useTrainRuns(trainNumber);
  const { gateways } = useTrainProviders();

  useEffect(() => {
    setDepartureDate(today);
    setUserPickedDate(false);
  }, [trainNumber, today]);

  useEffect(() => {
    if (!trainNumber || userPickedDate) return;
    const recommended =
      runs && runs.length > 0 ? pickDefaultRunDate(runs) : null;
    if (recommended !== null && recommended !== departureDate) {
      setDepartureDate(recommended);
    }
  }, [trainNumber, userPickedDate, runs, departureDate]);

  const selected = useMemo(
    () => (trainNumber ? { trainNumber, departureDate } : null),
    [trainNumber, departureDate],
  );

  const dates = useMemo<RunTab[]>(() => {
    if (!runs || runs.length === 0) return [];
    const past = runs.filter((run) => run <= today);
    const future = runs.filter((run) => run > today);
    const windowApi = [
      ...past.slice(Math.max(0, past.length - 3)),
      ...future.slice(0, 1),
    ];
    const currentRunApi = past.length ? past[past.length - 1] : null;
    const nextRunApi = future[0] ?? null;
    const recommended = pickDefaultRunDate(runs);
    return windowApi.map((apiDate) => {
      const isCurrent = apiDate === currentRunApi;
      const isNext = apiDate === nextRunApi;
      const iso = fromApiDate(apiDate);
      return {
        apiDate,
        iso,
        label: isCurrent ? "Today" : isNext ? "Next" : formatShortDate(iso),
        isDefault: recommended === apiDate,
        isSelected: departureDate === apiDate,
      };
    });
  }, [runs, today, departureDate]);

  const runsKnown = runs !== undefined;
  const statusEnabled =
    !!selected &&
    (runsError ||
      (runsKnown && (runs.length === 0 || runs.includes(departureDate))));

  const statusParams: TrainStatusQueryParams | null = selected
    ? {
        train_number: selected.trainNumber,
        departure_date: selected.departureDate,
        provider:
          gateway === GATEWAY_AUTO
            ? undefined
            : (gateway as GetTrainStatusProvider),
      }
    : null;

  const status = useTrainStatus(statusParams, statusEnabled);

  const refresh = useCallback(() => {
    void status.refetch();
  }, [status.refetch]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const interval = setInterval(() => {
      if (selectedRef.current) {
        refreshRef.current();
      }
    }, autoRefreshCadence);
    return () => clearInterval(interval);
  }, [autoRefreshEnabled, autoRefreshCadence, selected]);

  const selectDate = useCallback((apiDate: string) => {
    setUserPickedDate(true);
    setDepartureDate(apiDate);
  }, []);

  const setGateway = useCallback((g: string) => {
    setGatewayValue(g);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setAutoRefreshEnabled(enabled);
  }, []);

  const setCadence = useCallback((ms: number) => {
    setAutoRefreshCadence(ms);
  }, []);

  return {
    selected,
    runs,
    runsError,
    dates,
    activeDate: departureDate,
    selectDate,
    userPickedDate,
    gateway,
    setGateway,
    gateways,
    status: {
      data: status.data,
      isLoading: status.isLoading,
      isFetching: status.isFetching,
      isPlaceholderData: status.isPlaceholderData,
      isError: status.isError,
      errorType: status.errorType,
      refetch: refresh,
    },
    refresh,
    autoRefresh: {
      enabled: autoRefreshEnabled,
      cadenceMs: autoRefreshCadence,
      setEnabled,
      setCadence,
    },
  };
}

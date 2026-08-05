import { useCallback, useEffect, useMemo, useState } from "react";
import { getUpcomingDates, toApiDate } from "@workspace/trains-data";
import type { TrainEntry } from "@workspace/trains-data";
import { resolveTrain } from "../lib/validation";
import type { TrainValidationState } from "../lib/validation";

export interface UseTrainSearchOptions {
  trains: TrainEntry[];
  addRecent: (train: TrainEntry) => void;
}

export interface UseTrainSearchApi {
  trainNo: string;
  setTrainNo: (value: string) => void;
  trainValidity: TrainValidationState;
  setTrainValidity: (state: TrainValidationState) => void;
  selectedTrain: TrainEntry | null;
  setSelectedTrain: (train: TrainEntry | null) => void;
  headerNo: string;
  setHeaderNo: (value: string) => void;
  headerValidity: TrainValidationState;
  setHeaderValidity: (state: TrainValidationState) => void;
  headerSelected: TrainEntry | null;
  setHeaderSelected: (train: TrainEntry | null) => void;
  searched: boolean;
  apiParams: { train_number: string; departure_date: string };
  userPickedDate: boolean;
  handleSearchFormSubmit: () => void;
  handleSelectRecent: (train: TrainEntry) => void;
  handleResultsSearch: () => void;
  selectDate: (apiDate: string) => void;
  setDepartureDate: (apiDate: string) => void;
  reset: () => void;
}

/**
 * Owns the page-1 and results-header search state plus the "submitted" train
 * query. Search is explicit: typing alone never navigates — Enter, the submit
 * button, an autocomplete selection, or a recent chip does.
 */
export function useTrainSearch({
  trains,
  addRecent,
}: UseTrainSearchOptions): UseTrainSearchApi {
  const [trainNo, setTrainNo] = useState("");
  const [trainValidity, setTrainValidity] = useState<TrainValidationState>({
    status: "idle",
  });
  const [selectedTrain, setSelectedTrain] = useState<TrainEntry | null>(null);

  const [headerNo, setHeaderNo] = useState("");
  const [headerValidity, setHeaderValidity] = useState<TrainValidationState>({
    status: "idle",
  });
  const [headerSelected, setHeaderSelected] = useState<TrainEntry | null>(null);

  const [searched, setSearched] = useState(false);
  const [apiParams, setApiParams] = useState({
    train_number: "",
    departure_date: "",
  });

  /** True once the user picks a date tab manually; clears on a new train. */
  const [userPickedDate, setUserPickedDate] = useState(false);
  useEffect(() => {
    setUserPickedDate(false);
  }, [apiParams.train_number]);

  const today = useMemo(() => toApiDate(getUpcomingDates(1)[0]), []);

  /** Search a resolved train immediately (Enter, button, chip, or suggestion). */
  const submitSearch = useCallback(
    (train: TrainEntry) => {
      addRecent(train);
      setApiParams({ train_number: train.number, departure_date: today });
      setSearched(true);
    },
    [addRecent, today],
  );

  // Explicitly picking a train from a suggestion list or a recent chip is an
  // intent to search it, so it submits immediately. Typing alone never does.
  useEffect(() => {
    if (searched || !selectedTrain) return;
    submitSearch(selectedTrain);
  }, [searched, selectedTrain, submitSearch]);

  const handleSearchFormSubmit = () => {
    const train = resolveTrain(trainNo, selectedTrain, trains);
    if (!train) return;
    submitSearch(train);
  };

  const handleSelectRecent = (train: TrainEntry) => {
    setTrainNo(train.number);
    setSelectedTrain(train);
    setTrainValidity({ status: "valid", message: "hint.valid" });
  };

  const resetHeaderSearch = useCallback(() => {
    setHeaderNo("");
    setHeaderSelected(null);
    setHeaderValidity({ status: "idle" });
  }, []);

  const handleResultsSearch = () => {
    const train = resolveTrain(headerNo, headerSelected, trains);
    if (!train || train.number === apiParams.train_number) return;
    submitSearch(train);
    resetHeaderSearch();
  };

  // Selecting a train from the results-header suggestions submits it too.
  useEffect(() => {
    if (!searched || !headerSelected) return;
    if (headerSelected.number === apiParams.train_number) {
      resetHeaderSearch();
      return;
    }
    submitSearch(headerSelected);
    resetHeaderSearch();
  }, [
    searched,
    headerSelected,
    apiParams.train_number,
    submitSearch,
    resetHeaderSearch,
  ]);

  const selectDate = useCallback((apiDate: string) => {
    setUserPickedDate(true);
    setApiParams((prev) => ({ ...prev, departure_date: apiDate }));
  }, []);

  const setDepartureDate = useCallback((apiDate: string) => {
    setApiParams((prev) => ({ ...prev, departure_date: apiDate }));
  }, []);

  const reset = useCallback(() => {
    setSearched(false);
    setTrainNo("");
    setSelectedTrain(null);
    setTrainValidity({ status: "idle" });
    setHeaderNo("");
    setHeaderSelected(null);
    setHeaderValidity({ status: "idle" });
    setApiParams({ train_number: "", departure_date: "" });
  }, []);

  return {
    trainNo,
    setTrainNo,
    trainValidity,
    setTrainValidity,
    selectedTrain,
    setSelectedTrain,
    headerNo,
    setHeaderNo,
    headerValidity,
    setHeaderValidity,
    headerSelected,
    setHeaderSelected,
    searched,
    apiParams,
    userPickedDate,
    handleSearchFormSubmit,
    handleSelectRecent,
    handleResultsSearch,
    selectDate,
    setDepartureDate,
    reset,
  };
}

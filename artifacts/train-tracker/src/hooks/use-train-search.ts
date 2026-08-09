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
  value: string;
  setValue: (value: string) => void;
  validity: TrainValidationState;
  setValidity: (state: TrainValidationState) => void;
  selected: TrainEntry | null;
  setSelected: (train: TrainEntry | null) => void;
  searched: boolean;
  apiParams: { train_number: string; departure_date: string };
  setDepartureDate: (apiDate: string) => void;
  /** True once the user picked a run tab; the auto-land effect stops after. */
  userPickedDate: boolean;
  /** Pick a run tab explicitly; marks the choice as user-made. */
  selectDate: (apiDate: string) => void;
  handleSubmit: () => void;
  handleSelectRecent: (train: TrainEntry) => void;
  reset: () => void;
}

/**
 * Owns the search box state and the "submitted" train query. Search is
 * explicit: typing alone never navigates — Enter, the submit button, an
 * autocomplete selection, or a recent chip does.
 */
export function useTrainSearch({
  trains,
  addRecent,
}: UseTrainSearchOptions): UseTrainSearchApi {
  const [value, setValue] = useState("");
  const [validity, setValidity] = useState<TrainValidationState>({
    status: "idle",
  });
  const [selected, setSelected] = useState<TrainEntry | null>(null);

  const [searched, setSearched] = useState(false);
  const [apiParams, setApiParams] = useState({
    train_number: "",
    departure_date: "",
  });
  const [userPickedDate, setUserPickedDate] = useState(false);

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
    if (searched || !selected) return;
    submitSearch(selected);
  }, [searched, selected, submitSearch]);

  const handleSubmit = () => {
    const train = resolveTrain(value, selected, trains);
    if (!train) return;
    submitSearch(train);
  };

  const handleSelectRecent = (train: TrainEntry) => {
    setValue(train.number);
    setSelected(train);
    setValidity({ status: "valid", message: "Valid" });
  };

  const setDepartureDate = useCallback((apiDate: string) => {
    setApiParams((prev) => ({ ...prev, departure_date: apiDate }));
  }, []);

  const selectDate = useCallback((apiDate: string) => {
    setUserPickedDate(true);
    setApiParams((prev) => ({ ...prev, departure_date: apiDate }));
  }, []);

  const reset = useCallback(() => {
    setSearched(false);
    setValue("");
    setSelected(null);
    setValidity({ status: "idle" });
    setUserPickedDate(false);
    setApiParams({ train_number: "", departure_date: "" });
  }, []);

  return {
    value,
    setValue,
    validity,
    setValidity,
    selected,
    setSelected,
    searched,
    apiParams,
    setDepartureDate,
    userPickedDate,
    selectDate,
    handleSubmit,
    handleSelectRecent,
    reset,
  };
}

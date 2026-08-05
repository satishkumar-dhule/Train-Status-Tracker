import { useEffect, useState } from "react";

export type TrainView = "timeline" | "track";

export const VIEW_PREFERENCE_STORAGE_KEY = "terminal-track.view";

const VIEWS: readonly TrainView[] = ["timeline", "track"];

function readStoredView(): TrainView {
  try {
    const stored = window.localStorage.getItem(VIEW_PREFERENCE_STORAGE_KEY);
    return stored === "track" ? "track" : "timeline";
  } catch {
    return "timeline";
  }
}

export function useViewPreference(): [TrainView, (view: TrainView) => void] {
  const [view, setView] = useState<TrainView>(() =>
    typeof window === "undefined" ? "timeline" : readStoredView(),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_PREFERENCE_STORAGE_KEY, view);
    } catch {
      // Storage is unavailable; the preference simply won't persist.
    }
  }, [view]);

  const update = (next: TrainView) => {
    if (VIEWS.includes(next)) setView(next);
  };

  return [view, update];
}

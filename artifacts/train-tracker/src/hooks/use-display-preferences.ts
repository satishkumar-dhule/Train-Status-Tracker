import { useEffect, useState } from "react";

export type DisplayMode = "default" | "high-contrast" | "big-fonts" | "bw";

export const DISPLAY_PREFERENCES_STORAGE_KEY = "terminal-track.display";

const MODES: readonly DisplayMode[] = [
  "default",
  "high-contrast",
  "big-fonts",
  "bw",
];

export function isDisplayMode(value: unknown): value is DisplayMode {
  return (
    typeof value === "string" && (MODES as readonly string[]).includes(value)
  );
}

export function applyDisplayMode(mode: DisplayMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const candidate of MODES) {
    root.classList.remove(`mode-${candidate}`);
  }
  if (mode !== "default") {
    root.classList.add(`mode-${mode}`);
  }
}

function readStoredMode(): DisplayMode {
  try {
    const stored = window.localStorage.getItem(DISPLAY_PREFERENCES_STORAGE_KEY);
    return isDisplayMode(stored) ? stored : "default";
  } catch {
    return "default";
  }
}

export function useDisplayPreferences(): [
  DisplayMode,
  (mode: DisplayMode) => void,
] {
  const [mode, setMode] = useState<DisplayMode>(() =>
    typeof window === "undefined" ? "default" : readStoredMode(),
  );

  useEffect(() => {
    applyDisplayMode(mode);
    try {
      window.localStorage.setItem(DISPLAY_PREFERENCES_STORAGE_KEY, mode);
    } catch {
      // Storage is unavailable; the preference simply won't persist.
    }
  }, [mode]);

  const update = (next: DisplayMode) => {
    if (isDisplayMode(next)) setMode(next);
  };

  return [mode, update];
}

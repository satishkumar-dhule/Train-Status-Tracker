import { useEffect, useState } from "react";

export const AUTO_REFRESH_STORAGE_KEY = "terminal-track.auto-refresh";

/**
 * Whether the auto-refresh toggle is ON. Opt-in (default OFF) so the app
 * never polls the backend without the user asking for it.
 */
function readStoredAutoRefresh(): boolean {
  try {
    const stored = window.localStorage.getItem(AUTO_REFRESH_STORAGE_KEY);
    return stored === "true";
  } catch {
    return false;
  }
}

export function useAutoRefresh(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() =>
    typeof window === "undefined" ? false : readStoredAutoRefresh(),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(AUTO_REFRESH_STORAGE_KEY, String(enabled));
    } catch {
      // Storage is unavailable; the preference simply won't persist.
    }
  }, [enabled]);

  return [enabled, setEnabled];
}

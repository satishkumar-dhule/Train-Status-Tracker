import { useEffect, useState } from "react";

export const INVERT_STORAGE_KEY = "train-tracker.inverted";

/**
 * Applies the `inverted` class on <html>. The CSS rule `html.inverted` flips
 * the whole B&W palette, so components never know about inversion.
 */
export function applyInverted(inverted: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("inverted", inverted);
}

function readStoredInverted(): boolean {
  try {
    return window.localStorage.getItem(INVERT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function useInverted(): [boolean, (inverted: boolean) => void] {
  const [inverted, setInverted] = useState<boolean>(() =>
    typeof window === "undefined" ? false : readStoredInverted(),
  );

  useEffect(() => {
    applyInverted(inverted);
    try {
      window.localStorage.setItem(INVERT_STORAGE_KEY, String(inverted));
    } catch {
      // Storage unavailable; the preference simply won't persist.
    }
  }, [inverted]);

  return [inverted, setInverted];
}

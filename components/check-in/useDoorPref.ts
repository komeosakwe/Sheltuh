"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

export const VIBRATE_PREF_KEY = "sheltuh:door-vibrate";
export const SOUND_PREF_KEY = "sheltuh:door-sound";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** "true", "false" or null (unset or unreadable: storage can throw in private modes or when blocked). */
function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * A door setting remembered on this device (docs/design/check-in.md §5.A7).
 * If storage is unavailable the setting still works for this visit.
 */
export function useDoorPref(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const stored = useSyncExternalStore(
    subscribe,
    () => readStored(key),
    () => null,
  );
  const [override, setOverride] = useState<boolean | null>(null);
  const value = override ?? (stored === "true" ? true : stored === "false" ? false : fallback);

  const set = useCallback(
    (next: boolean) => {
      setOverride(next);
      try {
        window.localStorage.setItem(key, String(next));
      } catch {
        // Kept for this visit only.
      }
    },
    [key],
  );

  return [value, set];
}

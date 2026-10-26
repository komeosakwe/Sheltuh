"use client";

import { useEffect, useState } from "react";
import { loadLocation, loadedLocation, type LocationModule } from "@/lib/location-loader";

/**
 * lib/location.ts (with the Australia-wide suburb table), loaded on demand
 * the first time a component that needs it mounts (lib/location-loader.ts):
 * `module` is null until then; `failed` if it couldn't load, and `retry`
 * tries again. Used by near-you results and /map.
 */
export function useLocationModule(): { module: LocationModule | null; failed: boolean; retry: () => void } {
  const [table, setTable] = useState<LocationModule | null>(loadedLocation);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (table) return;
    let current = true;
    loadLocation().then(
      (loaded) => {
        if (current) setTable(loaded);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [table, attempt]);

  return {
    module: table,
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    },
  };
}

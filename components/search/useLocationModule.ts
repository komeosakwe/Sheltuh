"use client";

import { useEffect, useState } from "react";
import { loadLocation, loadedLocation, type LocationModule } from "@/lib/location-loader";

/**
 * lib/location.ts (with the Australia-wide suburb table), loaded on demand
 * the first time a component that needs it mounts (lib/location-loader.ts):
 * `module` is null until then; `failed` if it couldn't load, and `retry`
 * tries again. Used by near-you results and /map. `enabled: false` loads
 * nothing (yet): /map needs the table only for events without coordinates.
 */
export function useLocationModule(enabled = true): {
  module: LocationModule | null;
  failed: boolean;
  retry: () => void;
} {
  const [table, setTable] = useState<LocationModule | null>(loadedLocation);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled || table) return;
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
  }, [enabled, table, attempt]);

  return {
    module: table,
    failed,
    retry: () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    },
  };
}

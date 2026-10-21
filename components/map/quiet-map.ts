import type L from "leaflet";
import type { RefObject } from "react";

/**
 * "Search this area" appears after a `moveend` the person caused. Some Leaflet
 * calls fire a synchronous `moveend` even though nobody moved the map:
 * `map.stop()` re-applies the current zoom, and `invalidateSize()` re-centres
 * after a resize. This marks moveends fired *during* `action` as programmatic,
 * then restores the flag so it can't leak onto a later, real user move.
 */
export function runQuietly(programmaticMoveRef: RefObject<boolean>, action: () => void) {
  const previous = programmaticMoveRef.current;
  programmaticMoveRef.current = true;
  try {
    action();
  } finally {
    programmaticMoveRef.current = previous;
  }
}

/** `map.stop()` without it counting as a user move. */
export function stopQuietly(map: L.Map, programmaticMoveRef: RefObject<boolean>) {
  runQuietly(programmaticMoveRef, () => map.stop());
}

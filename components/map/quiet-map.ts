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

/**
 * `map.stop()` without it counting as a user move, and without the animation it would start.
 *
 * Leaflet's `stop()` is `setZoom(limitZoom(zoom))`, then cancelling any flight. That setZoom
 * *animates* the snap of a flight's part-way zoom to a whole one: the animation starts on the next
 * frame and, 250 ms later, puts the zoom and centre it was called at back over whatever the map was
 * set to meanwhile. A centre request applied right after the stop (a located visitor, a picked
 * suburb) was undone whenever the flight had got part-way. So this does the same without the
 * animation: the same snap (as Leaflet's `_limitZoom`), jumping. A setView cancels a flight too,
 * and fires one `moveend`, which is all `stop()` fired (SceneMapPanel.tsx's SearchThisAreaControl
 * counts one quiet `moveend` per programmatic move).
 */
export function stopQuietly(map: L.Map, programmaticMoveRef: RefObject<boolean>) {
  runQuietly(programmaticMoveRef, () => {
    const snap = map.options.zoomSnap;
    const snapped = snap ? Math.round(map.getZoom() / snap) * snap : map.getZoom();
    map.setZoom(Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), snapped)), { animate: false });
  });
}

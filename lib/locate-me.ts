import { GEOLOCATION_OPTIONS, hasGeolocation } from "./geolocation";
import { loadLocation } from "./location-loader";
import type { StateCode } from "./time-zones";
import type { Coordinates } from "./types";

/**
 * What asking the browser for the visitor's position came to. `found` has the
 * position (for the caller to centre the map, then drop) and the suburb it's
 * in; only the suburb's name and state may be kept.
 */
export type LocateResult =
  | { kind: "found"; position: Coordinates; suburb: string; state: StateCode }
  | { kind: "denied" }
  | { kind: "failed" }
  /** A position the suburb table can't place: overseas, or out at sea. */
  | { kind: "outside" };

/** Asks once (GEOLOCATION_OPTIONS) and matches the position to a suburb (lib/location.ts nearestLocality). */
export async function locateMe(): Promise<LocateResult> {
  if (!hasGeolocation()) return { kind: "failed" };
  const read = await new Promise<Coordinates | "denied" | "failed">((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) => resolve(error.code === error.PERMISSION_DENIED ? "denied" : "failed"),
      GEOLOCATION_OPTIONS,
    );
  });
  if (read === "denied" || read === "failed") return { kind: read };
  try {
    const result = (await loadLocation()).nearestLocality(read);
    if (result.kind === "outside") return { kind: "outside" };
    return { kind: "found", position: read, suburb: result.locality.name, state: result.locality.state };
  } catch {
    return { kind: "failed" };
  }
}

/** Per browser session (sessionStorage): /map doesn't ask again on every visit after a refusal. */
export const LOCATE_REFUSED_KEY = "sheltuh:map-locate-refused:v1";

function session(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Whether /map's own ask already came to nothing this session. */
export function wasLocateRefused(): boolean {
  try {
    return session()?.getItem(LOCATE_REFUSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remembers a refusal (or error, or timeout) for this session; false when storage can't be written. */
export function rememberLocateRefused(): boolean {
  const store = session();
  if (!store) return false;
  try {
    store.setItem(LOCATE_REFUSED_KEY, "1");
    return true;
  } catch {
    return false;
  }
}

import { trailingState } from "./place";
import { STATE_CODES, type StateCode } from "./time-zones";

/**
 * The visitor's chosen suburb for "near you" search, remembered in this
 * browser only: localStorage under `NEAR_STORAGE_KEY` as `{"suburb": string,
 * "state"?: StateCode}` and nothing else (never coordinates, never sent
 * anywhere). The state is the suburb table's, saved with the suburb when it's
 * chosen, so the home can list that state's events first without loading the
 * table (readStoredNearState). Storage can throw (private mode, quota,
 * blocked): reads then return "" (or null) and writes return false, and the
 * choice lasts only for the page.
 */
export const NEAR_STORAGE_KEY = "sheltuh:near:v1";

/**
 * The longest suburb kept or read from `near`; longer is cut. Here rather
 * than in lib/location.ts so the search bar can use it without loading the
 * suburb table.
 */
export const NEAR_MAX_LENGTH = 60;

/**
 * The `near` search parameter: its first value, trimmed, at most
 * NEAR_MAX_LENGTH characters. Here (re-exported by lib/location.ts) so
 * /search can read it without loading the suburb table.
 */
export function parseNearParam(value: string | string[] | undefined): string {
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim().slice(0, NEAR_MAX_LENGTH).trim();
}

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The stored suburb; "" when there's none or it's malformed. */
export function parseStoredNear(raw: string | null): string {
  if (!raw) return "";
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("suburb" in parsed) || typeof parsed.suburb !== "string") return "";
    return parsed.suburb.trim().slice(0, NEAR_MAX_LENGTH);
  } catch {
    return "";
  }
}

function isStateCode(value: unknown): value is StateCode {
  return typeof value === "string" && (STATE_CODES as readonly string[]).includes(value);
}

/**
 * The stored suburb's state: the one saved with it, else the state code its
 * name ends with (an entry saved before the state was: "Richmond NSW"), else
 * null ("Fitzroy" alone, or nothing stored). Never loads the suburb table.
 */
export function parseStoredNearState(raw: string | null): StateCode | null {
  const suburb = parseStoredNear(raw);
  if (!suburb || !raw) return null;
  const parsed: unknown = JSON.parse(raw);
  const saved = parsed && typeof parsed === "object" && "state" in parsed ? parsed.state : undefined;
  return isStateCode(saved) ? saved : trailingState(suburb);
}

/**
 * The page's own copy of a choice that storage refused (private mode, quota, blocked): reads fall back to it,
 * so the place chosen still drives this page (the map, its radius, the home's order) until the page goes.
 * `undefined` = nothing refused; `null` = refused while forgetting.
 */
let pageOnly: string | null | undefined;

function readRaw(): string | null {
  if (pageOnly !== undefined) return pageOnly;
  const store = local();
  if (!store) return null;
  try {
    return store.getItem(NEAR_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** The stored suburb, or "" when there's none or storage can't be read. */
export function readStoredNear(): string {
  return parseStoredNear(readRaw());
}

/** The stored suburb's state (parseStoredNearState), or null. */
export function readStoredNearState(): StateCode | null {
  return parseStoredNearState(readRaw());
}

const listeners = new Set<() => void>();

/**
 * Calls `onChange` when the stored suburb is written or forgotten, in this
 * page (the `storage` event only reaches other tabs) or another tab. For a
 * page that follows the visitor's location (/map).
 */
export function subscribeStoredNear(onChange: () => void): () => void {
  function handle(event: StorageEvent) {
    if (event.key === null || event.key === NEAR_STORAGE_KEY) {
      // Another tab saved a place: that one wins over this page's unsaved copy.
      pageOnly = undefined;
      onChange();
    }
  }
  listeners.add(onChange);
  window.addEventListener("storage", handle);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", handle);
  };
}

function notify() {
  for (const listener of Array.from(listeners)) listener();
}

/** Stores `suburb` (the table's name for it) and its state; false when storage can't be written. */
export function writeStoredNear(suburb: string, state?: StateCode | null): boolean {
  const raw = JSON.stringify({ suburb: suburb.trim().slice(0, NEAR_MAX_LENGTH), ...(state ? { state } : {}) });
  const store = local();
  let saved = false;
  if (store) {
    try {
      store.setItem(NEAR_STORAGE_KEY, raw);
      saved = true;
    } catch {
      saved = false;
    }
  }
  // Not saved: the page keeps the choice anyway, so what Where shows and what the page uses never differ.
  pageOnly = saved ? undefined : raw;
  notify();
  return saved;
}

/** Forgets the stored suburb; false when storage can't be written. */
export function clearStoredNear(): boolean {
  const store = local();
  let cleared = false;
  if (store) {
    try {
      store.removeItem(NEAR_STORAGE_KEY);
      cleared = true;
    } catch {
      cleared = false;
    }
  }
  pageOnly = cleared ? undefined : null;
  notify();
  return cleared;
}

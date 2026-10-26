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

function readRaw(): string | null {
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

/** Stores `suburb` (the table's name for it) and its state; false when storage can't be written. */
export function writeStoredNear(suburb: string, state?: StateCode | null): boolean {
  const store = local();
  if (!store) return false;
  try {
    const value = { suburb: suburb.trim().slice(0, NEAR_MAX_LENGTH), ...(state ? { state } : {}) };
    store.setItem(NEAR_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the stored suburb; false when storage can't be written. */
export function clearStoredNear(): boolean {
  const store = local();
  if (!store) return false;
  try {
    store.removeItem(NEAR_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

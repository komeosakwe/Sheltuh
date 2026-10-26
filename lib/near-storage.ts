/**
 * The visitor's chosen suburb for "near you" search, remembered in this
 * browser only: localStorage under `NEAR_STORAGE_KEY` as `{"suburb": string}`
 * and nothing else (never coordinates, never sent anywhere). Storage can
 * throw (private mode, quota, blocked): reads then return "" and writes
 * return false, and the choice lasts only for the page.
 */
export const NEAR_STORAGE_KEY = "sheltuh:near:v1";

/**
 * The longest suburb kept or read from `near`; longer is cut. Here rather
 * than in lib/location.ts so the search bar can use it without loading the
 * suburb table.
 */
export const NEAR_MAX_LENGTH = 60;

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

/** The stored suburb, or "" when there's none or storage can't be read. */
export function readStoredNear(): string {
  const store = local();
  if (!store) return "";
  try {
    return parseStoredNear(store.getItem(NEAR_STORAGE_KEY));
  } catch {
    return "";
  }
}

/** Stores `suburb` (only the name); false when storage can't be written. */
export function writeStoredNear(suburb: string): boolean {
  const store = local();
  if (!store) return false;
  try {
    store.setItem(NEAR_STORAGE_KEY, JSON.stringify({ suburb: suburb.trim().slice(0, NEAR_MAX_LENGTH) }));
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

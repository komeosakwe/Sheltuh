/**
 * Demo-mode saved events (no accounts configured): this browser's list,
 * newest save first, in localStorage under `SAVED_STORAGE_KEY` as
 * `{"ids": string[]}`. Nothing leaves the browser. Storage can throw
 * (private mode, quota, blocked): reads then return null and writes return
 * false, and the caller keeps the list in memory instead.
 */

export const SAVED_STORAGE_KEY = "sheltuh:saved:v1";

function local(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Parses the stored value; anything malformed is an empty list. */
export function parseSavedIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !("ids" in parsed) || !Array.isArray(parsed.ids)) return [];
    const ids = parsed.ids.filter((id: unknown): id is string => typeof id === "string" && id.length > 0);
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

/** The stored ids, or null when storage can't be read. */
export function readSavedIds(): string[] | null {
  const store = local();
  if (!store) return null;
  try {
    return parseSavedIds(store.getItem(SAVED_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Stores `ids`; false when storage can't be written. */
export function writeSavedIds(ids: readonly string[]): boolean {
  const store = local();
  if (!store) return false;
  try {
    store.setItem(SAVED_STORAGE_KEY, JSON.stringify({ ids }));
    return true;
  } catch {
    return false;
  }
}

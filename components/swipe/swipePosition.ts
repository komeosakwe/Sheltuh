/** Where the visitor is in the swipe feed, kept for the tab so Back from an event returns to it. */
const KEY = "sheltuh:swipe-position";

/** The stored event id, or null (none stored, or storage is unavailable). */
export function readSwipePosition(): string | null {
  try {
    return window.sessionStorage.getItem(KEY);
  } catch {
    // Storage blocked (private mode, policy): the feed just starts at the top.
    return null;
  }
}

export function saveSwipePosition(eventId: string): void {
  try {
    window.sessionStorage.setItem(KEY, eventId);
  } catch {
    // Storage blocked or full: losing the place is harmless.
  }
}

export function clearSwipePosition(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored that we could clear.
  }
}

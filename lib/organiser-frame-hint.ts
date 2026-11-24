/**
 * Whether this browser last showed the signed-in account the organiser dashboard's frame (they
 * were an approved organiser), so on the next page load the frame can be kept in place while
 * their organiser record loads, instead of the page jumping into it a moment later
 * (components/dashboard/OrganiserShell.tsx). Stored as the account's user id only (no name, no
 * email), in localStorage; a hint, never a permission: the record decides, and a stale hint
 * only means an empty frame for that moment.
 */
const KEY = "sheltuh:organiser-frame";

export function wasFramed(userId: string | undefined): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(KEY) === userId;
  } catch {
    // Storage blocked (private mode, a policy): no hint, the page simply waits for the record.
    return false;
  }
}

export function rememberFramed(userId: string | undefined, framed: boolean) {
  if (!userId || typeof window === "undefined") return;
  try {
    if (framed) window.localStorage.setItem(KEY, userId);
    else if (window.localStorage.getItem(KEY) === userId) window.localStorage.removeItem(KEY);
  } catch {
    // As above: without storage there's just no hint next time.
  }
}

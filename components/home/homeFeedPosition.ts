/**
 * Where the visitor left the phone home's event screens, kept for the tab so
 * Back from an event scrolls to it again. Separate from the /swipe feed's key.
 *
 * It is saved when a link in an event's screen is followed, and taken (read
 * and removed) once, when the screens next mount, and only if that was a
 * Back or Forward (`popstate`). Following a plain link to the home, or
 * reloading it, starts at the top.
 *
 * The browser would restore the page's scroll on Back itself, smoothly (the
 * root is `scroll-behavior: smooth`) and before the events have loaded, which
 * fights the jump to the event. So saving a place also hands this history
 * entry's scroll to us (`scrollRestoration = "manual"`), and taking it hands
 * it back.
 */
const KEY = "sheltuh:home-feed-position";

let traversed = false;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    traversed = true;
  });
}

export function saveHomeFeedPosition(eventId: string): void {
  try {
    window.sessionStorage.setItem(KEY, eventId);
    window.history.scrollRestoration = "manual";
  } catch {
    // Storage blocked or full: losing the place is harmless.
  }
}

/** The stored event id when arriving by Back or Forward, else null. Always clears it. */
export function takeHomeFeedPosition(): string | null {
  const arrivedByHistory = traversed;
  traversed = false;
  window.history.scrollRestoration = "auto";
  try {
    const id = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return arrivedByHistory ? id : null;
  } catch {
    // Storage blocked (private mode, policy): the home just starts at the top.
    return null;
  }
}

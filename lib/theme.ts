/**
 * The Light / Dark theme (docs/design/theme-white-dark.md §5.3). Light is the
 * default for everyone and is "no attribute" on <html>; Dark is
 * `data-theme="dark"`, set before first paint by `THEME_INIT_SCRIPT` when the
 * visitor chose it. The choice lives in this browser only: a functional
 * on-device setting, not personal information.
 */
export type Theme = "light" | "dark";

/** localStorage key. Stored values are exactly "light" or "dark"; anything else (or none) means Light. */
export const THEME_STORAGE_KEY = "sheltuh:theme";

const ATTRIBUTE = "data-theme";

/**
 * The no-flash script: inline and synchronous, the first child of the root
 * layout's <head> (app/layout.tsx; React hoists the charset, viewport,
 * stylesheet, async chunks and Next's metadata above it), so it runs before
 * any of <body> is parsed and the page paints in the stored theme on its
 * first frame. It only ever turns Dark on, and only from a stored "dark": a first
 * visit (or a storage error) is always Light, whatever the OS prefers. The
 * theme-color meta is black in both themes (the black header, lib/pwa/theme.ts),
 * so it's never touched.
 */
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})!=="dark")return;document.documentElement.setAttribute("${ATTRIBUTE}","dark")}catch(e){}})();`;

/** The current theme, from <html> (the single source of truth once the script has run). */
export function getTheme(): Theme {
  return document.documentElement.getAttribute(ATTRIBUTE) === "dark" ? "dark" : "light";
}

/** The stored choice; a missing or unknown value, or a storage error, is Light. */
export function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

const listeners = new Set<() => void>();

/** For useSyncExternalStore: called whenever the theme is applied. */
export function subscribeTheme(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

/** useSyncExternalStore's server snapshot: the server always renders Light. */
export function getServerTheme(): Theme {
  return "light";
}

/** Puts a theme on the page (the attribute) and tells subscribers, without storing it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute(ATTRIBUTE, "dark");
  else root.removeAttribute(ATTRIBUTE);
  for (const listener of listeners) listener();
}

/**
 * The visitor's choice: applied at once and stored for next time. If storage
 * fails (private mode, quota), it still applies for the page's life.
 */
export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not stored: the theme still applies until the page is closed.
  }
  applyTheme(theme);
}

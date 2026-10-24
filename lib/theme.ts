import { APP_THEME_COLOR, DARK_THEME_COLOR } from "@/lib/pwa/theme";

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
 * Set by the script on the theme-color meta it turned black. React matches
 * a hoisted <meta> by its content, so it doesn't adopt the changed one at
 * hydration and renders its own: the marked one is then a stale copy, and
 * `syncThemeColor` removes it.
 */
const SCRIPT_FIXED = "data-theme-fixed";

/**
 * The no-flash script: inline and synchronous, the first child of the root
 * layout's <head> (app/layout.tsx; React hoists the charset, viewport,
 * stylesheet, async chunks and Next's metadata above it), so it runs before
 * any of <body> is parsed and the page paints in the stored theme on its
 * first frame. It only ever turns Dark on, and only from a stored "dark": a first
 * visit (or a storage error) is always Light, whatever the OS prefers. It
 * also swaps a white theme-color meta to black, now and once the head has
 * parsed (in case the meta comes after it); the door's own colour is never
 * touched.
 */
export const THEME_INIT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})!=="dark")return;var d=document.documentElement;d.setAttribute("${ATTRIBUTE}","dark");var fix=function(){if(d.getAttribute("${ATTRIBUTE}")!=="dark")return;var m=document.querySelector('meta[name="theme-color"]');if(m&&m.content.toLowerCase()===${JSON.stringify(APP_THEME_COLOR)}){m.content=${JSON.stringify(DARK_THEME_COLOR)};m.setAttribute("${SCRIPT_FIXED}","")}};fix();document.addEventListener("DOMContentLoaded",fix)}catch(e){}})();`;

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

/**
 * Keeps the browser chrome in step with the page: in Dark a white
 * theme-color becomes black, in Light a black one becomes white. Any other
 * value (the door's #0b0b0b) is left alone. Once React has rendered its
 * own theme-color, the stale copy the script changed is removed.
 */
export function syncThemeColor(theme: Theme = getTheme()): void {
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  const stale = metas.filter((meta) => meta.hasAttribute(SCRIPT_FIXED));
  if (stale.length < metas.length) for (const meta of stale) meta.remove();
  const [from, to] = theme === "dark" ? [APP_THEME_COLOR, DARK_THEME_COLOR] : [DARK_THEME_COLOR, APP_THEME_COLOR];
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    if (meta.content.toLowerCase() === from) meta.content = to;
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

/** Puts a theme on the page (attribute and theme-color) and tells subscribers, without storing it. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") root.setAttribute(ATTRIBUTE, "dark");
  else root.removeAttribute(ATTRIBUTE);
  syncThemeColor(theme);
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

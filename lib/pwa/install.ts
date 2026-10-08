/**
 * Rules for the "add to home screen" affordance (components/pwa/InstallPrompt.tsx).
 * See docs/pwa.md.
 */

/** Chrome's install event. Not in TypeScript's DOM lib: it's non-standard. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

export function isBeforeInstallPromptEvent(event: Event): event is BeforeInstallPromptEvent {
  return typeof (event as Partial<BeforeInstallPromptEvent>).prompt === "function";
}

/**
 * Browsing pages only. Never an event page (ticket selector, buy bar),
 * checkout, messages, sign-in/up, account, dashboard or admin. Exact
 * matches, so "/events" is the list and not "/events/<slug>".
 */
const INSTALL_PROMPT_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/events",
  "/map",
  "/search",
  "/about",
  "/help",
  "/partners",
]);

export function installPromptAllowedOn(pathname: string | null | undefined): boolean {
  return typeof pathname === "string" && INSTALL_PROMPT_PATHS.has(pathname);
}

/** Other iOS browsers and in-app browsers, where Safari's steps would be wrong. */
const NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA\/|Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|Twitter|LinkedInApp|Pinterest|TikTok|musical_ly|WhatsApp/i;

/**
 * Safari on iPhone, iPod or iPad. iPadOS Safari reports a Mac user agent by
 * default, so a "Macintosh" with a touch screen counts as an iPad.
 */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  const iosDevice = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  if (!iosDevice) return false;
  if (NOT_SAFARI.test(userAgent)) return false;
  return /Version\/[\d.]+/.test(userAgent) && /Safari\//.test(userAgent);
}

/** Running as an installed app (any platform), so there's nothing to install. */
export function isStandalone(win: Window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  if (typeof win.matchMedia !== "function") return false;
  return ["standalone", "fullscreen", "minimal-ui"].some(
    (mode) => win.matchMedia(`(display-mode: ${mode})`).matches,
  );
}

export type InstallPlatform = "standalone" | "ios-safari" | "other";

export function detectInstallPlatform(win: Window): InstallPlatform {
  if (isStandalone(win)) return "standalone";
  if (isIosSafari(win.navigator.userAgent, win.navigator.maxTouchPoints ?? 0)) return "ios-safari";
  return "other";
}

/* "No thanks", remembered per browser. */

export const INSTALL_DISMISSED_KEY = "sheltuh:install-dismissed";

// When storage is blocked (some private modes), the choice lasts for this page view.
let dismissedThisPageView = false;
const listeners = new Set<() => void>();

export function getInstallDismissed(): boolean {
  if (dismissedThisPageView) return true;
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}

export function rememberInstallDismissed(): void {
  dismissedThisPageView = true;
  try {
    window.localStorage.setItem(INSTALL_DISMISSED_KEY, new Date().toISOString());
  } catch {
    // Storage unavailable: dismissedThisPageView above still hides it until the page is reloaded.
  }
  listeners.forEach((listener) => listener());
}

export function subscribeInstallDismissed(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab saying "No thanks" hides it here too.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Tests only: forget the in-memory dismissal between cases. */
export function resetInstallDismissedForTests(): void {
  dismissedThisPageView = false;
}

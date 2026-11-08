/**
 * In-app browsers (Instagram, Facebook, TikTok and the like open links in their own WebView). On
 * iOS those usually can't share the visitor's location, so a failed "Use my current location" /
 * "Near me" says so and offers a way out to the real browser (docs/architecture.md, "Location
 * (near you)"). Pure: the caller passes the user agent and the address.
 */

// Order matters: Instagram and Threads are Meta apps whose agents can also carry Facebook markers,
// and Messenger's carries FBAN too, so the narrower names come first.
const IN_APP_BROWSERS: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
  ["Instagram", /Instagram/i],
  ["Threads", /Barcelona/],
  ["Messenger", /FBAN\/MessengerForiOS|Orca-Android|MessengerLite/i],
  ["Facebook", /FBAN|FBAV|FB_IAB/],
  ["TikTok", /musical_ly|BytedanceWebview|TikTok/i],
  ["Snapchat", /Snapchat/i],
  ["LinkedIn", /LinkedInApp/],
  ["Pinterest", /Pinterest/i],
  ["X", /Twitter for iPhone|TwitterAndroid/],
];

/** The app whose in-app browser this user agent belongs to, or null for an ordinary browser. */
export function inAppBrowserName(userAgent: string): string | null {
  for (const [name, pattern] of IN_APP_BROWSERS) if (pattern.test(userAgent)) return name;
  return null;
}

export interface OpenInBrowser {
  /** "Open in Chrome". */
  label: string;
  href: string;
  /** The browser's name: "Chrome". */
  browser: string;
}

const ANDROID = /Android/;

/**
 * A link that hands `currentUrl` to the device's own browser: Chrome on Android (an `intent:` URL),
 * nothing elsewhere. Only for https addresses, and the fragment is left off (it can carry tokens),
 * as is any user info.
 *
 * No link on iOS: Instagram's and the other apps' browsers ignore `x-safari-https:` (an owner tested
 * it in Instagram: nothing happens), so iOS gets the app's own menu instead (inAppLocationHelp).
 */
export function openInBrowserHref(currentUrl: string, userAgent: string): OpenInBrowser | null {
  let url: URL;
  try {
    url = new URL(currentUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const target = `${url.host}${url.pathname}${url.search}`;
  if (ANDROID.test(userAgent)) {
    return {
      label: "Open in Chrome",
      browser: "Chrome",
      href: `intent://${target}#Intent;scheme=https;package=com.android.chrome;end`,
    };
  }
  return null;
}

export interface InAppLocationHelp {
  text: string;
  link: { label: string; href: string } | null;
}

/**
 * What to say when location fails inside an in-app browser: the sentence, and the way out when
 * there is one. Null in an ordinary browser (the caller keeps its usual message).
 */
export function inAppLocationHelp(currentUrl: string, userAgent: string): InAppLocationHelp | null {
  const app = inAppBrowserName(userAgent);
  if (!app) return null;
  const open = openInBrowserHref(currentUrl, userAgent);
  const lead = `${app}’s browser can’t share your location. Type your suburb`;
  // No link that works (iOS, or not https): the app's ••• menu has "Open in browser".
  if (!open) return { text: `${lead}, or open Sheltüh in your browser from the ••• menu.`, link: null };
  return { text: `${lead}, or open Sheltüh in ${open.browser}.`, link: { label: open.label, href: open.href } };
}

/** `inAppLocationHelp` for this page and browser; null on the server or in an ordinary browser. */
export function currentInAppLocationHelp(): InAppLocationHelp | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  return inAppLocationHelp(window.location.href, navigator.userAgent);
}

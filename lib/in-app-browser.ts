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
  /** "Open in Safari" or "Open in Chrome". */
  label: string;
  href: string;
  /** The browser's name: "Safari" or "Chrome". */
  browser: string;
}

// iPadOS asks for desktop sites, so its agent says Macintosh; the "Mobile" token still gives it away.
const IOS = /iPhone|iPad|iPod|Macintosh.*Mobile/;
const ANDROID = /Android/;

/**
 * A link that hands `currentUrl` to the device's own browser: Safari on iOS (`x-safari-https:`),
 * Chrome on Android (an `intent:` URL), nothing elsewhere. Only for https addresses, and the
 * fragment is left off (it can carry tokens), as is any user info.
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
  if (IOS.test(userAgent)) {
    return { label: "Open in Safari", browser: "Safari", href: `x-safari-https://${target}` };
  }
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
  if (!open) return { text: `${lead}.`, link: null };
  return { text: `${lead}, or open Sheltüh in ${open.browser}.`, link: { label: open.label, href: open.href } };
}

/** `inAppLocationHelp` for this page and browser; null on the server or in an ordinary browser. */
export function currentInAppLocationHelp(): InAppLocationHelp | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  return inAppLocationHelp(window.location.href, navigator.userAgent);
}

/**
 * In-app browsers: the web views social and messaging apps open links in
 * (most people find events through Instagram). Google refuses to sign anyone
 * in inside one ("disallowed_useragent"), so "Continue with Google" explains
 * how to get out of it instead of starting (components/auth/OAuthButtons.tsx).
 */

/**
 * The apps' own user-agent tokens: Google's search app (GSA), Instagram,
 * Facebook and Messenger (FBAN, FBAV, FB_IAB), LINE, Snapchat, X (Twitter),
 * LinkedIn, Pinterest, TikTok (musical_ly) and WhatsApp. Real browsers
 * (Chrome, Firefox, Edge, Opera on iOS...) aren't here. lib/pwa/install.ts
 * builds its "not Safari" list from this one.
 */
export const IN_APP_BROWSER_TOKENS =
  /GSA\/|Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|Twitter|LinkedInApp|Pinterest|TikTok|musical_ly|WhatsApp/i;

/** Android's WebView marks itself "; wv)" in the platform part of its user agent. */
const ANDROID_WEB_VIEW = /; wv\)/;

/** Whether this user agent is an app's embedded browser rather than a real one. */
export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP_BROWSER_TOKENS.test(userAgent) || ANDROID_WEB_VIEW.test(userAgent);
}

export type DevicePlatform = "ios" | "android" | "other";

/**
 * iOS (iPhone, iPod, or an iPad, which reports a Mac with a touch screen),
 * Android, or anything else: which browser to suggest opening the page in.
 */
export function devicePlatform(userAgent: string, maxTouchPoints = 0): DevicePlatform {
  if (/iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) return "ios";
  if (/Android/.test(userAgent)) return "android";
  return "other";
}

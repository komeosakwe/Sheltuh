import { APP_LINK_PATHS } from "@/lib/mobile/well-known";
import { safeNextPath } from "@/lib/safe-next-path";

/**
 * The page a link that opened the app should show (an App Link or Universal
 * Link, Capacitor's `appUrlOpen`), as a same-site path, or null to ignore it.
 *
 * Only a link to the app's own site counts: `appOrigin` is the origin the app
 * shell loaded (window.location.origin, i.e. capacitor.config.ts server.url).
 * Another host, another scheme (a custom `au.com.sheltuh.app://` link, a
 * `javascript:` URL), credentials in the URL, or a path safeNextPath refuses
 * ("//evil.example" after dot segments, control characters…), or a path the
 * deep-link rules exclude (lib/mobile/well-known.ts) all return null, so the
 * app stays where it is.
 */
export function deepLinkPath(url: unknown, appOrigin: string): string | null {
  if (typeof url !== "string" || url.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // "null" for custom and opaque schemes, so those never match.
  if (parsed.origin === "null" || parsed.origin !== appOrigin) return null;
  if (parsed.username || parsed.password) return null;
  // Addresses the deep-link rules keep out of the app (the calendar file). Android 14 and lower
  // can't exclude them, so the app may still be opened with one: it stays where it is.
  if (isExcludedAppLink(parsed.pathname)) return null;
  return safeNextPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
}

/** A path rule from APP_LINK_PATHS as a regular expression: "*" is any run of characters, as on both platforms. */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`);
}

const EXCLUDED = APP_LINK_PATHS.filter((rule) => rule.exclude).map((rule) => patternToRegExp(rule.path));

/** Whether a link's path is one the app must not show (lib/mobile/well-known.ts, APP_LINK_PATHS). */
export function isExcludedAppLink(pathname: string): boolean {
  return EXCLUDED.some((pattern) => pattern.test(pathname));
}

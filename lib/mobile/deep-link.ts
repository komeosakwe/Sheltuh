import { safeNextPath } from "@/lib/safe-next-path";

/**
 * The page a link that opened the app should show (an App Link or Universal
 * Link, Capacitor's `appUrlOpen`), as a same-site path, or null to ignore it.
 *
 * Only a link to the app's own site counts: `appOrigin` is the origin the app
 * shell loaded (window.location.origin, i.e. capacitor.config.ts server.url).
 * Another host, another scheme (a custom `au.com.sheltuh.app://` link, a
 * `javascript:` URL), credentials in the URL, or a path safeNextPath refuses
 * ("//evil.example" after dot segments, control characters…) all return null,
 * so the app stays where it is.
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
  return safeNextPath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
}

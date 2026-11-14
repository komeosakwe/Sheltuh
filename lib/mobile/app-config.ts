/**
 * The phone app's identity and the site it loads, for capacitor.config.ts
 * (docs/mobile-app.md). A plain module with no `@/` imports: the Capacitor CLI
 * loads capacitor.config.ts, and this file, with its own TypeScript loader,
 * which doesn't know the project's path aliases.
 */

/**
 * The Android application id and the iOS bundle id, decided by the owner
 * (13–14 Nov 2026). **Permanent once the app is published**: a store listing
 * can never change it. See docs/mobile-app.md, "Decided".
 */
export const APP_ID = "au.com.sheltuh.app";

/** The name under the icon. */
export const APP_NAME = "Sheltüh";

/**
 * The live site the app shell opens (docs/DEPLOYMENT.md: the site is
 * https://sheltuh.com.au). The trailing slash matters: iOS's Capacitor keeps
 * a navigation inside the app when its URL *starts with* this string, so
 * without the slash "https://sheltuh.com.au.example" would count as ours.
 */
export const DEFAULT_APP_SERVER_URL = "https://sheltuh.com.au/";

/** The variable `npx cap sync` reads to point a build at another deployment. */
export const APP_SERVER_URL_VARIABLE = "SHELTUH_APP_URL";

/**
 * Hosts a debug build may reach over plain http: this computer, and the
 * Android emulator's alias for it (10.0.2.2), for testing against `next dev`.
 */
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "10.0.2.2"]);

export interface AppServer {
  /** The origin with a trailing slash, e.g. "https://sheltuh.com.au/". */
  url: string;
  /** True only for a plain-http local development server. */
  cleartext: boolean;
}

/**
 * The site a build of the app opens: SHELTUH_APP_URL if set, else
 * production. Only an origin (scheme, host, optional port) is accepted: https
 * anywhere, plain http only for a local development server. Anything else
 * throws, naming the variable, so `npx cap sync` stops instead of building an
 * app that opens the wrong place.
 */
export function resolveAppServer(raw: string | undefined): AppServer {
  const value = raw?.trim();
  if (!value) return { url: DEFAULT_APP_SERVER_URL, cleartext: false };

  const problem = `${APP_SERVER_URL_VARIABLE} must be an https origin such as ${DEFAULT_APP_SERVER_URL} (or http://localhost:3000 for a local dev server)`;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${problem}; it isn't a URL.`);
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
    throw new Error(`${problem}; it must have no path, query, fragment or credentials.`);
  }
  if (url.protocol === "https:") return { url: `${url.origin}/`, cleartext: false };
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return { url: `${url.origin}/`, cleartext: true };
  throw new Error(`${problem}; plain http is only allowed for localhost, 127.0.0.1 or 10.0.2.2.`);
}

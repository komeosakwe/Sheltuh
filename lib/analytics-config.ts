/**
 * Usage analytics settings (PostHog; docs/architecture.md, "Usage analytics
 * (PostHog)"). Pure and free of browser and Node APIs, so next.config.ts (to
 * build the /ingest rewrites), the browser (lib/analytics.ts) and the tests
 * all read the settings the same way.
 *
 * Analytics is OFF unless NEXT_PUBLIC_POSTHOG_KEY is set to a PostHog project
 * API key. NEXT_PUBLIC_POSTHOG_HOST says which PostHog region receives it.
 */

/** The first-party path the browser sends to; next.config.ts rewrites it to PostHog (ad blockers don't skew the numbers). */
export const INGEST_PATH = "/ingest";

/** PostHog's US cloud, used when NEXT_PUBLIC_POSTHOG_HOST isn't set. */
export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

export interface AnalyticsConfig {
  /** The project API key (`phc_…`): public by design, it can only add events. */
  key: string;
  /** Where /ingest is proxied to (proxy.ts): the region's ingestion host, e.g. https://us.i.posthog.com. */
  apiHost: string;
  /** The PostHog app's address, for links back to it from the toolbar. */
  uiHost: string;
}

/** `phc_…` is a project API key. A personal (`phx_…`) or secret key must never be put in a NEXT_PUBLIC_ variable. */
const PROJECT_KEY = /^phc_[A-Za-z0-9]+$/;

/**
 * NEXT_PUBLIC_POSTHOG_KEY is inlined into the browser bundle, so (like the
 * Stripe publishable key, next.config.ts) a wrong value must stop the build
 * rather than ship. Unset is fine: analytics is then off. The message names
 * the variable, never its value.
 */
export function assertPostHogKey(value: string | undefined): void {
  const key = value?.trim();
  if (key && !PROJECT_KEY.test(key)) {
    throw new Error(
      "NEXT_PUBLIC_POSTHOG_KEY must be a PostHog project API key (phc_…), or unset to turn analytics off. " +
        "It's built into the browser bundle: never put a personal (phx_…) or other secret key in it.",
    );
  }
}

/** `https`, or `http` for this machine only (a local stand-in for PostHog). */
function usableHost(url: URL): boolean {
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
}

/** The hosts for a PostHog ingestion host, or null if it isn't an https address. */
function hostsFor(host: string): Pick<AnalyticsConfig, "apiHost" | "uiHost"> | null {
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    return null;
  }
  if (!usableHost(url)) return null;
  const apiHost = url.origin;
  // PostHog Cloud: us.i.posthog.com / eu.i.posthog.com, with the app on <region>.posthog.com.
  // Anything else (a self-hosted instance) serves both itself.
  const cloud = /^(us|eu)\.i\.posthog\.com$/.exec(url.hostname);
  if (!cloud) return { apiHost, uiHost: apiHost };
  return { apiHost, uiHost: `https://${cloud[1]}.posthog.com` };
}

/**
 * With a key set, NEXT_PUBLIC_POSTHOG_HOST must be an https address (unset is
 * the US cloud): a typo would otherwise switch analytics off without a word. The
 * message names the variable, never its value.
 */
export function assertPostHogHost(keyValue: string | undefined, hostValue: string | undefined): void {
  if (!keyValue?.trim() || !hostValue?.trim()) return;
  if (!hostsFor(hostValue.trim())) {
    throw new Error(
      "NEXT_PUBLIC_POSTHOG_HOST must be the https address of a PostHog host, e.g. https://us.i.posthog.com or https://eu.i.posthog.com, " +
        "or unset (the US cloud). Analytics won't start with it as it is.",
    );
  }
}

/** The settings for the two environment variables, or null: no key (or an unusable key or host) means analytics is off. */
export function resolveAnalyticsConfig(keyValue: string | undefined, hostValue: string | undefined): AnalyticsConfig | null {
  const key = keyValue?.trim();
  if (!key || !PROJECT_KEY.test(key)) return null;
  const hosts = hostsFor(hostValue?.trim() || DEFAULT_POSTHOG_HOST);
  return hosts ? { key, ...hosts } : null;
}

/**
 * The only PostHog endpoints the browser needs with our settings (events are
 * sent to /e/; nothing is loaded from PostHog at run time and no feature flags
 * are asked for). Everything else under /ingest is refused (proxy.ts), so the
 * proxy can't be used as an open relay to the rest of PostHog's API.
 */
const INGEST_ALLOWED: ReadonlySet<string> = new Set(["/e/", "/i/v0/e/", "/batch/"]);

/**
 * Where a request for `pathname` (starting `/ingest`) goes on PostHog's ingestion
 * host, or null if it isn't one of the endpoints above. A missing trailing slash
 * is added.
 */
export function ingestTarget(pathname: string): string | null {
  if (!pathname.startsWith(`${INGEST_PATH}/`)) return null;
  const rest = pathname.slice(INGEST_PATH.length);
  const path = rest.endsWith("/") ? rest : `${rest}/`;
  return INGEST_ALLOWED.has(path) ? path : null;
}

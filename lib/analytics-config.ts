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
  /** Where /ingest/* is proxied to: the region's ingestion host, e.g. https://us.i.posthog.com. */
  apiHost: string;
  /** Where PostHog serves its static files from (the region's assets host). */
  assetsHost: string;
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

/** The hosts for a PostHog ingestion host, or null if it isn't an http(s) address. */
function hostsFor(host: string): Pick<AnalyticsConfig, "apiHost" | "assetsHost" | "uiHost"> | null {
  let url: URL;
  try {
    url = new URL(host);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const apiHost = url.origin;
  // PostHog Cloud: us.i.posthog.com / eu.i.posthog.com, with assets on <region>-assets.i.posthog.com and
  // the app on <region>.posthog.com. Anything else (a self-hosted instance) serves all three itself.
  const cloud = /^(us|eu)\.i\.posthog\.com$/.exec(url.hostname);
  if (!cloud) return { apiHost, assetsHost: apiHost, uiHost: apiHost };
  return {
    apiHost,
    assetsHost: `https://${cloud[1]}-assets.i.posthog.com`,
    uiHost: `https://${cloud[1]}.posthog.com`,
  };
}

/** The settings for the two environment variables, or null: no key (or an unusable key or host) means analytics is off. */
export function resolveAnalyticsConfig(keyValue: string | undefined, hostValue: string | undefined): AnalyticsConfig | null {
  const key = keyValue?.trim();
  if (!key || !PROJECT_KEY.test(key)) return null;
  const hosts = hostsFor(hostValue?.trim() || DEFAULT_POSTHOG_HOST);
  return hosts ? { key, ...hosts } : null;
}

/**
 * next.config.ts's rewrites: /ingest/* to PostHog. Its static files and
 * remote config have their own host, and must come first (the catch-all
 * would take them).
 */
export function ingestRewrites(config: AnalyticsConfig | null): { source: string; destination: string }[] {
  if (!config) return [];
  return [
    { source: `${INGEST_PATH}/static/:path*`, destination: `${config.assetsHost}/static/:path*` },
    { source: `${INGEST_PATH}/array/:path*`, destination: `${config.assetsHost}/array/:path*` },
    { source: `${INGEST_PATH}/:path*`, destination: `${config.apiHost}/:path*` },
  ];
}

import type { ViewSource } from "@/lib/api/types";

/**
 * Buckets where an event-page view came from, in the browser, so only the
 * bucket is ever sent (docs/architecture.md, "Organiser analytics"): never
 * the referrer URL, its path or its query.
 *
 * Order of precedence: `utm_source` / `utm_medium` on the page URL (the
 * sharer said where it was posted), then the referrer's hostname. `tracking`
 * is never chosen here: the server sets it when the view carries one of the
 * event's own codes.
 *
 * In-app navigations keep the referrer the visit started with (the browser
 * doesn't change `document.referrer` on client-side navigation), so a view is
 * counted under where the visit to Sheltüh began. A referrer on this site
 * itself (a full reload, say) counts as `direct`.
 */

type Rule = { source: Exclude<ViewSource, "tracking" | "direct" | "other">; test: (host: string) => boolean };

/** `host` is `domain` or a subdomain of it. */
const on = (host: string, ...domains: string[]) => domains.some((d) => host === d || host.endsWith(`.${d}`));

// Email before search: mail.google.com is webmail, not Google Search.
const HOST_RULES: Rule[] = [
  {
    source: "email",
    test: (h) =>
      on(h, "mail.google.com", "outlook.live.com", "outlook.office.com", "outlook.office365.com", "mail.yahoo.com", "mail.proton.me", "fastmail.com", "com.google.android.gm") ||
      /^(webmail|mail)\./.test(h),
  },
  { source: "instagram", test: (h) => on(h, "instagram.com", "com.instagram.android") },
  { source: "facebook", test: (h) => on(h, "facebook.com", "fb.com", "fb.me", "messenger.com", "com.facebook.katana") },
  { source: "x", test: (h) => on(h, "t.co", "twitter.com", "x.com") },
  { source: "tiktok", test: (h) => on(h, "tiktok.com") },
  { source: "eventbrite", test: (h) => /(^|\.)eventbrite\.[a-z.]+$/.test(h) },
  {
    source: "search",
    test: (h) =>
      /(^|\.)google\.[a-z.]+$/.test(h) ||
      /(^|\.)yandex\.[a-z.]+$/.test(h) ||
      on(h, "bing.com", "duckduckgo.com", "search.yahoo.com", "ecosia.org", "baidu.com", "search.brave.com", "startpage.com", "kagi.com", "com.google.android.googlequicksearchbox"),
  },
];

const UTM_RULES: { source: Rule["source"]; pattern: RegExp }[] = [
  { source: "email", pattern: /^(e-?mail|newsletter|mailchimp|klaviyo|campaign-?monitor|substack|edm)$/ },
  { source: "instagram", pattern: /^(instagram|ig|insta)$/ },
  { source: "facebook", pattern: /^(facebook|fb|meta|messenger)$/ },
  { source: "x", pattern: /^(x|twitter)$/ },
  { source: "tiktok", pattern: /^(tiktok|tt)$/ },
  { source: "eventbrite", pattern: /^eventbrite$/ },
  { source: "search", pattern: /^(google|bing|duckduckgo|ddg|yahoo|ecosia|brave|kagi)$/ },
];

function fromUtm(params: URLSearchParams): ViewSource | null {
  const medium = params.get("utm_medium")?.trim().toLowerCase() ?? "";
  if (/^(e-?mail|newsletter|edm)$/.test(medium)) return "email";
  const raw = params.get("utm_source")?.trim().toLowerCase();
  if (!raw) return null;
  return UTM_RULES.find((rule) => rule.pattern.test(raw))?.source ?? "other";
}

function referrerHost(referrer: string): string | null {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    // Android apps send "android-app://com.instagram.android/".
    const host = url.hostname || url.host;
    return host ? host.toLowerCase().replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

export function viewSourceFrom({
  referrer,
  search,
  ownHost,
}: {
  /** `document.referrer`. */
  referrer: string;
  /** `location.search`. */
  search: string;
  /** `location.hostname`. */
  ownHost: string;
}): ViewSource {
  const utm = fromUtm(new URLSearchParams(search));
  if (utm) return utm;

  const host = referrerHost(referrer);
  if (!host) return "direct";
  if (host === ownHost.toLowerCase().replace(/^www\./, "")) return "direct";
  return HOST_RULES.find((rule) => rule.test(host))?.source ?? "other";
}

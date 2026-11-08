/**
 * What usage analytics (PostHog, and Vercel Web Analytics / Speed Insights)
 * may see of an address, and when it may run at all
 * (docs/architecture.md, "Usage analytics (PostHog)").
 *
 * One module for all the tools, with no browser or Node dependencies, so each
 * tool's last-chance hook (PostHog's before_send, Vercel's beforeSend) applies
 * the same rules, and the tests can check them directly:
 *  - /admin is never reported.
 *  - A fragment is never kept, and a query string is cut down to its campaign
 *    (utm_*) parameters on every page. That covers the pages whose addresses
 *    carry a credential: an order reference (/checkout/success?session_id=…),
 *    a one-time sign-in code (/auth/callback?code=…), and the tokens in the
 *    fragments of /waitlist/*, /following/*, /holder-messages/stop, /invite and
 *    /organisers/join. A suburb in /search?near= goes too.
 *  - Ids of people (a member profile, a conversation) and ticket codes in an
 *    address are replaced by a placeholder, and an order reference (`ord_…`) is
 *    removed from anything that is sent.
 */

/** Pages never reported at all (their path and every one beneath). */
const EXCLUDED_PREFIXES = ["/admin"] as const;

/** Campaign parameters, the only query parameters kept, on every page (marketing attribution). */
const CAMPAIGN_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

/** An order reference, wherever it turns up. */
const ORDER_REFERENCE = /ord_[A-Za-z0-9_-]*/g;
/** A ticket code (`7KQM-2HXD`) as a whole path segment. */
const TICKET_CODE_SEGMENT = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

const PLACEHOLDER_BASE = "https://analytics.invalid";
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** The path of an address, for deciding what it is. "" for something that isn't an address. */
function pathOf(raw: string): string {
  try {
    return new URL(raw, PLACEHOLDER_BASE).pathname;
  } catch {
    return "";
  }
}

/** /admin or anything beneath it: not reported at all. */
export function isExcludedPath(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => underPrefix(pathname, prefix));
}

/** Whether an address (absolute or a path) is a page that must never be reported. */
export function isExcludedUrl(raw: string): boolean {
  return isExcludedPath(pathOf(raw));
}

/** Removes order references from any text. */
export function scrubText(text: string): string {
  return text.replace(ORDER_REFERENCE, "[redacted]");
}

/** The path with the parts that identify a person or a ticket replaced by a placeholder. */
export function sanitizePathname(pathname: string): string {
  const segments = pathname.split("/");
  // segments[0] is "" (before the leading slash).
  const first = segments[1];
  const second = segments[2];
  if (first === "members" && second) segments.splice(2, segments.length - 2, "[profileId]");
  else if (first === "messages" && second && second !== "blocked") segments.splice(2, segments.length - 2, "[conversationId]");
  else if (first === "tickets" && second) segments.splice(2, segments.length - 2, "[code]");
  const cleaned = segments.map((segment) => (TICKET_CODE_SEGMENT.test(segment) ? "[code]" : segment));
  return scrubText(cleaned.join("/"));
}

/**
 * An address as analytics may see it. Absolute in, absolute out (its origin
 * is kept); a path in, a path out. Anything that isn't an http(s) address
 * becomes "". `campaign: false` drops the query string whatever the page
 * (for a referrer, which belongs to another site).
 */
export function sanitizeUrl(raw: string, options: { campaign?: boolean } = {}): string {
  const { campaign = true } = options;
  let url: URL;
  try {
    url = new URL(raw, PLACEHOLDER_BASE);
  } catch {
    return "";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "";
  const absolute = HAS_SCHEME.test(raw);
  const path = sanitizePathname(url.pathname);
  let query = "";
  if (campaign) {
    const kept = new URLSearchParams();
    for (const name of CAMPAIGN_PARAMS) {
      const value = url.searchParams.get(name);
      if (value) kept.set(name, scrubText(value).slice(0, 100));
    }
    const text = kept.toString();
    query = text ? `?${text}` : "";
  }
  return `${absolute ? url.origin : ""}${path}${query}`;
}

/** A Vercel Web Analytics or Speed Insights event, as far as the rules here go. */
interface VercelEventLike {
  url: string;
  route?: string | null;
}

/**
 * Vercel Web Analytics' and Speed Insights' `beforeSend`: nothing from
 * /admin, and an address cleaned by sanitizeUrl. The same event, changed in
 * its `url` (and its `route`, the page pattern such as /events/[slug], which
 * holds no values, only scrubbed in case), or null to drop it.
 */
export function sanitizeVercelEvent<T extends VercelEventLike>(event: T, optedOut = false): T | null {
  if (optedOut || isExcludedUrl(event.url)) return null;
  const cleaned: T = { ...event, url: sanitizeUrl(event.url) };
  if (typeof event.route === "string") {
    if (isExcludedPath(event.route)) return null;
    cleaned.route = scrubText(event.route);
  }
  return cleaned;
}

// ---------------------------------------------------------------------------
// PostHog
// ---------------------------------------------------------------------------

/** Properties PostHog adds that hold a full address. */
const URL_PROPERTIES = [
  "$current_url",
  "$initial_current_url",
  "$session_entry_url",
  "$external_click_url",
] as const;
/** Properties that hold the address a visitor came from (another site's, or one of ours). */
const REFERRER_PROPERTIES = ["$referrer", "$initial_referrer", "$session_entry_referrer"] as const;
/** Properties that hold only a path. */
const PATH_PROPERTIES = ["$pathname", "$initial_pathname", "$session_entry_pathname"] as const;

/** Advertising and mailing click ids PostHog would otherwise attach from the address; passed to its property_denylist. */
export const DENIED_PROPERTIES = [
  "gclid",
  "gclsrc",
  "gbraid",
  "wbraid",
  "dclid",
  "fbclid",
  "msclkid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "rdt_cid",
  "epik",
  "qclid",
  "sccid",
  "irclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_kx",
] as const;

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every string in `value` scrubbed of order references, to a few levels deep. */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (depth >= 4) return value;
  if (Array.isArray(value)) return value.map((item) => scrubDeep(item, depth + 1));
  if (isBag(value)) return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, scrubDeep(item, depth + 1)]));
  return value;
}

/** The address properties of one property bag, cleaned. */
function cleanBag(bag: Bag): Bag {
  const out: Bag = {};
  for (const [name, value] of Object.entries(bag)) {
    if (typeof value === "string" && (URL_PROPERTIES as readonly string[]).includes(name)) out[name] = sanitizeUrl(value);
    else if (typeof value === "string" && (REFERRER_PROPERTIES as readonly string[]).includes(name)) {
      // PostHog's own marker for no referrer ("$direct") is not an address.
      out[name] = value.startsWith("$") ? value : sanitizeUrl(value, { campaign: false });
    } else if (typeof value === "string" && (PATH_PROPERTIES as readonly string[]).includes(name)) out[name] = sanitizePathname(value);
    else out[name] = scrubDeep(value);
  }
  return out;
}

/** The page an event happened on, from the properties PostHog adds. */
function pageOf(properties: Bag): string {
  const path = properties["$pathname"];
  if (typeof path === "string") return path;
  const url = properties["$current_url"];
  return typeof url === "string" ? pathOf(url) : "";
}

/** The parts of a PostHog capture (its CaptureResult) the rules touch. */
interface CaptureLike {
  properties?: Bag;
  $set?: Bag;
  $set_once?: Bag;
}

/**
 * PostHog's `before_send`: null (drop the event) for anything that happened
 * on /admin, otherwise the same event with every address property cleaned
 * (query strings and fragments off, ids and ticket codes replaced), order
 * references removed from every string, and a referrer reduced to its path.
 * The input is never changed.
 */
export function sanitizePostHogEvent<T extends CaptureLike>(event: T | null): T | null {
  if (!event) return null;
  const properties = event.properties ?? {};
  if (isExcludedPath(pageOf(properties))) return null;
  const cleaned: T = { ...event };
  if (event.properties) cleaned.properties = cleanBag(event.properties);
  if (event.$set) cleaned.$set = cleanBag(event.$set);
  if (event.$set_once) cleaned.$set_once = cleanBag(event.$set_once);
  return cleaned;
}

// ---------------------------------------------------------------------------
// Do Not Track and Global Privacy Control
// ---------------------------------------------------------------------------

/** The parts of `navigator` (and `window`) that say a visitor doesn't want to be tracked. */
export interface PrivacySignals {
  doNotTrack?: string | null;
  msDoNotTrack?: string | null;
  globalPrivacyControl?: boolean;
}

/**
 * Whether the browser asks not to be tracked: Do Not Track on ("1" or "yes")
 * or Global Privacy Control on. Either one turns every analytics tool off.
 */
export function browserOptsOut(navigatorSignals: PrivacySignals | undefined, windowDoNotTrack?: unknown): boolean {
  const dnt = [navigatorSignals?.doNotTrack, navigatorSignals?.msDoNotTrack, windowDoNotTrack];
  if (dnt.some((value) => value === "1" || value === "yes")) return true;
  return navigatorSignals?.globalPrivacyControl === true;
}

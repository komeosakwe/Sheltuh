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
 *    /organisers/join. A suburb in /search?near= goes too. A campaign value
 *    is kept only in the shape our own links have (campaignParamValue): an
 *    email address or a token put in utm_* by a crafted link is dropped. A campaign value
 *    is kept only in the shape our own links have (campaignParamValue): an
 *    email address or a token put in utm_* by a crafted link is dropped.
 *  - Ids of people (a member profile, a conversation) and ticket codes in an
 *    address are replaced by a placeholder, and an order reference (`ord_…`) is
 *    removed from anything that is sent.
 */
import { CAMPAIGN_VALUE_MAX, campaignValue } from "@/lib/campaign-links";

/** Pages never reported at all (their path and every one beneath). */
const EXCLUDED_PREFIXES = ["/admin"] as const;

/** Campaign parameters, the only query parameters kept, on every page (marketing attribution). */
const CAMPAIGN_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

/** A uuid, or a long run of hex: an id or a token, not a campaign name. */
const ID_LIKE = /^(?:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|[0-9a-f]{24,})$/;

/** An order reference, wherever it turns up. Not global: it is also used to test a value. */
const ORDER_REFERENCE_TEST = /ord_/;
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

/**
 * A campaign parameter's value as analytics may keep it, or null to drop the parameter. Only the shape
 * the Campaign links page makes (lib/campaign-links.ts campaignValue): lower case letters, digits, "-"
 * and "_", at most CAMPAIGN_VALUE_MAX characters. Anything else (an email address, a token, words with
 * spaces or percent-encoding, an order reference, an id) is a crafted link and is dropped whole. Upper
 * case is lowered, as the page would have. The value is the visitor's to type in a link, so nothing else
 * is trusted.
 */
export function campaignParamValue(raw: string): string | null {
  const value = raw.toLowerCase();
  if (value.length === 0 || value.length > CAMPAIGN_VALUE_MAX) return null;
  if (value !== campaignValue(value)) return null;
  if (ORDER_REFERENCE_TEST.test(value) || ID_LIKE.test(value)) return null;
  return value;
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
      const value = campaignParamValue(url.searchParams.get(name) ?? "");
      if (value) kept.set(name, value);
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

/**
 * Click ids and mailing ids PostHog would attach from the address (and its own
 * copies of them: `$initial_…`, `$session_entry_…`, `$fbc`, `$fbp`). Passed to
 * its property_denylist, and dropped again by the sanitiser.
 */
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
  "fbc",
  "fbp",
  "ph_keyword",
] as const;

/**
 * Query parameters this site's addresses can carry that are not campaign tags:
 * a token, a code, an order or payment reference, an email address, a search or
 * a suburb. PostHog masks their values in any address it stores itself
 * (`mask_personal_data_properties`: `$initial_person_info` in the browser's
 * storage, `$session_entry_*`, `$initial_*`), on top of the sanitiser.
 */
export const PERSONAL_QUERY_PARAMS = [
  "token",
  "code",
  "session_id",
  "order",
  "payment_intent",
  "payment_intent_client_secret",
  "setup_intent",
  "setup_intent_client_secret",
  "client_secret",
  "redirect_status",
  "email",
  "q",
  "near",
  "suburb",
  "next",
  "sel",
  "ticket",
  "state",
  "sb_flow_id",
  "error",
  "error_description",
] as const;

const DENIED_NAMES: ReadonlySet<string> = new Set(DENIED_PROPERTIES);
/** `$initial_gclid`, `$session_entry_fbclid`, `gclid`, `$fbc`: the name without PostHog's prefixes. */
const PROPERTY_PREFIX = /^\$?(?:initial_|session_entry_)?/;

function isDeniedProperty(name: string): boolean {
  return DENIED_NAMES.has(name.replace(PROPERTY_PREFIX, ""));
}

/** `utm_source`, `$initial_utm_campaign`, `$session_entry_utm_medium`…: PostHog's own copies of the campaign parameters. */
const CAMPAIGN_PROPERTY = /^\$?(?:initial_|session_entry_)?utm_(?:source|medium|campaign|term|content)$/;

/** The kinds of address a property can hold, by its name (`$current_url`, `$initial_referrer`, `$prev_pageview_pathname`…). */
function addressKind(name: string): "url" | "referrer" | "path" | null {
  const key = name.toLowerCase();
  if (/(?:^|[_$])url$/.test(key)) return "url";
  if (/referrer$/.test(key)) return "referrer";
  if (/(?:^|[_$])pathname$/.test(key)) return "path";
  return null;
}

type Bag = Record<string, unknown>;

function isBag(value: unknown): value is Bag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A string that is an address on /admin: "https://site/admin/…" or "/admin/…". */
const ADMIN_ADDRESS = /^(?:https?:\/\/[^/?#]+)?\/admin(?:[/?#]|$)/i;

function isAdminAddress(value: unknown): boolean {
  return typeof value === "string" && ADMIN_ADDRESS.test(value.trim());
}

/**
 * Every string in `value` scrubbed of order references, to a few levels deep, and every address on /admin
 * left out (an entry of an object, an item of a list): PostHog keeps copies of addresses in nested
 * properties too (`$initial_person_info`).
 */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (depth >= 4) return value;
  if (Array.isArray(value)) return value.filter((item) => !isAdminAddress(item)).map((item) => scrubDeep(item, depth + 1));
  if (isBag(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => !isAdminAddress(item))
        .map(([name, item]) => [name, scrubDeep(item, depth + 1)]),
    );
  }
  return value;
}

/** Properties that describe what the visitor looked at: the page's title can hold a member's name ("Alice — Messages"). */
const DROPPED_PROPERTIES: ReadonlySet<string> = new Set(["title", "$title"]);

/**
 * One property bag, cleaned: every address property (by its name, so the ones
 * PostHog adds later are covered too) is cut down, click ids and the page title
 * are dropped, and order references are removed from everything else.
 * `dropPrevious`: the page before this one was not to be reported, so what is
 * known of it (`$prev_pageview_*`) goes too.
 */
function cleanBag(bag: Bag, dropPrevious: boolean): Bag {
  const out: Bag = {};
  for (const [name, value] of Object.entries(bag)) {
    if (DROPPED_PROPERTIES.has(name) || isDeniedProperty(name)) continue;
    if (CAMPAIGN_PROPERTY.test(name) && typeof value === "string") {
      // A campaign value that isn't the shape our own links have is a crafted link: not kept (campaignParamValue).
      const kept = campaignParamValue(value);
      if (kept !== null) out[name] = kept;
      continue;
    }
    if (dropPrevious && name.startsWith("$prev_pageview_")) continue;
    const kind = typeof value === "string" ? addressKind(name) : null;
    if (typeof value !== "string" || kind === null) {
      // Any other address on /admin (in any property) is left out too.
      if (!isAdminAddress(value)) out[name] = scrubDeep(value);
    } else if (kind === "referrer") {
      // PostHog's own marker for no referrer ("$direct") is not an address; an /admin page as the
      // referrer is reported as no referrer, as PostHog does when it has none.
      if (value.startsWith("$")) out[name] = value;
      else out[name] = isExcludedUrl(value) ? "$direct" : sanitizeUrl(value, { campaign: false });
    } else if (isExcludedUrl(value)) {
      // The visit's entry page, first page or any other address property was an /admin page: gone.
      continue;
    } else if (kind === "url") {
      out[name] = sanitizeUrl(value);
    } else {
      out[name] = sanitizePathname(value);
    }
  }
  return out;
}

/** The previous page of the visit was /admin: PostHog remembers it in `$prev_pageview_pathname` even when that view was dropped. */
function previousWasExcluded(bags: (Bag | undefined)[]): boolean {
  return bags.some((bag) => {
    const previous = bag?.["$prev_pageview_pathname"];
    return typeof previous === "string" && isExcludedPath(pathOf(previous));
  });
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
  const dropPrevious = previousWasExcluded([event.properties, event.$set, event.$set_once]);
  const cleaned: T = { ...event };
  if (event.properties) cleaned.properties = cleanBag(event.properties, dropPrevious);
  if (event.$set) cleaned.$set = cleanBag(event.$set, dropPrevious);
  if (event.$set_once) cleaned.$set_once = cleanBag(event.$set_once, dropPrevious);
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

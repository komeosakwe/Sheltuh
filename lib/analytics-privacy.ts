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
 *  - An error report (PostHog's `$exception`) keeps only its error's class name, a redacted message
 *    and its stack frames' locations (sanitizeExceptionList).
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
    if (name.startsWith(EXCEPTION_PREFIX)) {
      // An error report: only its cleaned list and level are kept (breadcrumbs and the rest go).
      if (name === EXCEPTION_LIST) out[name] = sanitizeExceptionList(value);
      else if (name === EXCEPTION_LEVEL && typeof value === "string" && EXCEPTION_LEVELS.has(value)) out[name] = value;
      continue;
    }
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

// ---------------------------------------------------------------------------
// Error reports (PostHog's `$exception` events)
// ---------------------------------------------------------------------------

/** The error report properties kept: the cleaned list of errors and its level. Any other `$exception_*` (breadcrumbs above all) is dropped. */
const EXCEPTION_LIST = "$exception_list";
const EXCEPTION_LEVEL = "$exception_level";
const EXCEPTION_LEVELS: ReadonlySet<string> = new Set(["fatal", "error", "warning", "log", "info", "debug"]);
const EXCEPTION_PREFIX = "$exception_";

/** At most this many errors (a cause chain) and frames per error are kept. */
const MAX_EXCEPTIONS = 5;
const MAX_FRAMES = 60;
const MAX_MESSAGE = 500;

/** An error's class name (TypeError, ChunkLoadError, DOMException…): only class-shaped names, since an object's `name` can be anything. */
const ERROR_TYPE = /^(?:[A-Z][\w$]{0,60}(?:Error|Exception|Rejection|Event)|Error|DOMException)$/;
/** A function name from a stack frame (`Object.load`, `async fetchOrder`, `<anonymous>`, `Array.map [as foo]`, `handleClick/<`): identifier shapes only. */
const FUNCTION_NAME = /^(?:async |new )?[\w$.<>[\]/]{1,120}(?: \[as [\w$]{1,60}\])?$/;
/** Where a frame's code ran when it isn't an address. */
const FRAME_PLACES: ReadonlySet<string> = new Set(["<anonymous>", "native", "[native code]"]);
const PLATFORMS: ReadonlySet<string> = new Set(["web:javascript", "node:javascript", "hermes"]);
const MECHANISM_TYPE = /^[a-z_]{1,40}$/;
const CHUNK_ID = /^[\w-]{1,100}$/;

const MESSAGE_URL = /\bhttps?:\/\/[^\s"'`<>]+/gi;
/** A site path with a query or fragment (`/api/profiles/search?q=…`), wherever it starts: after a space, a bracket or punctuation (`failed:/search?near=…`). */
const MESSAGE_PATH = /(^|[^\w/.~%-])(\/[^\s"'`<>?#]*[?#][^\s"'`<>]*)/g;
const MESSAGE_EMAIL = /[^\s@"'`<>()[\]]{1,64}@[^\s@"'`<>()[\]]{1,253}\.[^\s@"'`<>()[\]]{1,63}/g;
/**
 * Quoted text: in an error message this is usually a value (JSON.parse echoes its input, a failed
 * check echoes what it got). Greedy, from the first quote of a kind to the last (across line breaks),
 * so quotes nested in quotes (a JSON fragment) and values with a newline in them are covered too. A
 * single quote counts only where it can open or close a quotation, not as the apostrophe in "couldn't".
 */
const MESSAGE_QUOTED = /"[^]*"|`[^]*`|“[^]*”|‘[^]*’|(^|[^\p{L}\p{N}])'[^]*'(?![\p{L}\p{N}])/gu;
/** A quote left open once the pairs are gone: everything after it is treated as quoted. */
const MESSAGE_OPEN_QUOTE = /["`“‘]|(?:^|[^\p{L}\p{N}])'/u;
const QUOTE_SLOT = /\u0001/g;
const MESSAGE_UUID = /\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi;
/** A ticket code (`7KQM-2HXD`). */
const MESSAGE_TICKET_CODE = /\b[A-Z0-9]{4}-[A-Z0-9]{4}\b/g;
/** A token: a long run of letters, digits and token punctuation that has a digit in it (hex, base64, JWTs, secrets). */
const MESSAGE_TOKEN = /[A-Za-z0-9_+/=.-]{20,}/g;
/** A run that may be a phone or card number; replaced only when it holds 7 or more digits and isn't a date. */
const MESSAGE_NUMBER = /\+?\d[\d\s-]{5,}\d/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/**
 * PostHog's own wording for something thrown or rejected that isn't an Error (@posthog/core's coercers):
 * what follows is the value itself, which can be any data, so it is never kept.
 */
const RAW_VALUE_PREFIXES = ["Non-Error promise rejection captured with value: ", "Primitive value captured as exception: "] as const;

/**
 * An error message as PostHog may keep it: web addresses and site paths cleaned as page addresses
 * are, and email addresses, quoted text, order references, uuids, ticket codes, tokens and long numbers
 * replaced by placeholders. What is left is the error's own wording ("Cannot read properties of
 * undefined (reading '[redacted]')"), cut to MAX_MESSAGE characters. Best effort: a name or other
 * detail written into a message without quotes can't be recognised.
 */
export function redactErrorMessage(raw: string): string {
  const prefix = RAW_VALUE_PREFIXES.find((start) => raw.startsWith(start));
  if (prefix) return `${prefix}[redacted]`;
  // Cut long input first (the patterns stay cheap), and drop the word the cut went through, so a
  // half address or token can't slip past the patterns.
  const text = raw.length > MAX_MESSAGE * 4 ? raw.slice(0, MAX_MESSAGE * 4).replace(/\S*$/, "") : raw;
  let redacted = text
    .replace(QUOTE_SLOT, "")
    .replace(MESSAGE_EMAIL, "[email]")
    .replace(MESSAGE_URL, (url) => {
      const trimmed = url.replace(/[).,;:!?]+$/, "");
      const cleaned = isExcludedUrl(trimmed) ? "[address]" : sanitizeUrl(trimmed, { campaign: false }) || "[address]";
      return cleaned + url.slice(trimmed.length);
    })
    .replace(MESSAGE_PATH, (_match, lead: string, path: string) =>
      `${lead}${isExcludedUrl(path) ? "[address]" : sanitizeUrl(path, { campaign: false }) || "[address]"}`,
    );
  // Cleaning an address can lengthen it (percent-encoding): cut again before the remaining patterns.
  if (redacted.length > MAX_MESSAGE * 4) redacted = redacted.slice(0, MAX_MESSAGE * 4).replace(/\S*$/, "");
  // Each quotation becomes a slot (its quote marks kept aside), so the open-quote check below sees only unpaired marks.
  const quotes: string[] = [];
  redacted = redacted.replace(MESSAGE_QUOTED, (quoted: string, lead: string | undefined) => {
    const body = quoted.slice((lead ?? "").length);
    quotes.push(`${body[0]}[redacted]${body[body.length - 1]}`);
    return `${lead ?? ""}\u0001`;
  });
  const open = MESSAGE_OPEN_QUOTE.exec(redacted);
  if (open) {
    const quoteAt = open.index + open[0].length - 1;
    redacted = `${redacted.slice(0, quoteAt + 1)}[redacted]`;
  }
  redacted = redacted
    .replace(QUOTE_SLOT, () => quotes.shift() ?? "")
    .replace(ORDER_REFERENCE, "[redacted]")
    .replace(MESSAGE_UUID, "[id]")
    .replace(MESSAGE_TICKET_CODE, "[code]")
    .replace(MESSAGE_TOKEN, (run) => (/\d/.test(run) && !run.startsWith("/") ? "[redacted]" : run))
    .replace(MESSAGE_NUMBER, (run) => (ISO_DATE.test(run) || (run.match(/\d/g)?.length ?? 0) < 7 ? run : "[number]"));
  return redacted.length > MAX_MESSAGE ? `${redacted.slice(0, MAX_MESSAGE)}…` : redacted;
}

/** A frame's file: an address cleaned like a page's (no query or fragment), or a fixed marker; null to leave it out. */
function frameFile(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (FRAME_PLACES.has(value)) return value;
  // A real frame's file is a script's absolute address. Anything else was parsed out of message text.
  if (!/^https?:\/\//i.test(value)) return null;
  return sanitizeUrl(value, { campaign: false }) || null;
}

function cleanFrame(frame: unknown): Bag | null {
  if (!isBag(frame)) return null;
  const out: Bag = {};
  if (typeof frame.platform === "string" && PLATFORMS.has(frame.platform)) out.platform = frame.platform;
  const filename = frameFile(frame.filename);
  const absPath = frameFile(frame.abs_path);
  // No script address: a "frame" made from a line of the message (Chromium's stack starts with it).
  if (!filename && !absPath) return null;
  if (filename) out.filename = filename;
  if (absPath) out.abs_path = absPath;
  const name = frame.function;
  // Identifier shapes only, and none that looks like an order reference or a token (a long run with a digit).
  const tokenLike = typeof name === "string" && (name.match(/[\w$]{20,}/g) ?? []).some((run) => /\d/.test(run));
  if (typeof name === "string" && FUNCTION_NAME.test(name) && !ORDER_REFERENCE_TEST.test(name) && !tokenLike) out.function = name;
  for (const key of ["lineno", "colno"] as const) {
    if (typeof frame[key] === "number" && Number.isFinite(frame[key])) out[key] = frame[key];
  }
  if (typeof frame.in_app === "boolean") out.in_app = frame.in_app;
  if (typeof frame.chunk_id === "string" && CHUNK_ID.test(frame.chunk_id)) out.chunk_id = frame.chunk_id;
  // Never kept: source lines around the frame (context_line, pre_/post_context), variables (vars), module.
  return out;
}

function cleanMechanism(mechanism: unknown): Bag | undefined {
  if (!isBag(mechanism)) return undefined;
  const out: Bag = {};
  if (typeof mechanism.handled === "boolean") out.handled = mechanism.handled;
  if (typeof mechanism.synthetic === "boolean") out.synthetic = mechanism.synthetic;
  if (typeof mechanism.type === "string" && MECHANISM_TYPE.test(mechanism.type)) out.type = mechanism.type;
  for (const key of ["exception_id", "parent_id"] as const) {
    if (typeof mechanism[key] === "number" && Number.isFinite(mechanism[key])) out[key] = mechanism[key];
  }
  return out;
}

function framesOf(exception: Bag): unknown[] {
  const stacktrace = exception.stacktrace;
  return isBag(stacktrace) && Array.isArray(stacktrace.frames) ? stacktrace.frames : [];
}

/** Whether any frame of the error ran from an /admin page (an inline script's file is the page's address). */
function exceptionTouchesAdmin(list: unknown): boolean {
  if (!Array.isArray(list)) return false;
  return list.some(
    (exception) =>
      isBag(exception) &&
      framesOf(exception).some(
        (frame) =>
          isBag(frame) &&
          [frame.filename, frame.abs_path].some((file) => typeof file === "string" && isExcludedUrl(file)),
      ),
  );
}

/**
 * PostHog's `$exception_list`, rebuilt from the fields it needs and nothing else: each error's class
 * name, its message (redactErrorMessage), how it was caught, and its stack frames' file (cleaned),
 * function, line and column. Source lines, variables and anything PostHog adds later are left out.
 */
/** PostHog's wording for an object thrown with no message: only its keys (code), not their values. */
const KEYS_ONLY = / captured as exception with keys: [\w$, ]{0,500}$/;

/**
 * The message of something thrown or rejected that isn't an Error (PostHog marks it `synthetic`): a
 * string, or an object's `message`, is whatever the code put there, so it isn't kept. Kept: the
 * browser's "Script error." (a cross-origin script), PostHog's keys-only wording, and its prefixes.
 */
function syntheticValue(value: string): string {
  if (value === "Script error.") return value;
  if (KEYS_ONLY.test(value) || RAW_VALUE_PREFIXES.some((prefix) => value.startsWith(prefix))) return redactErrorMessage(value);
  return "[redacted]";
}

export function sanitizeExceptionList(list: unknown): Bag[] {
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_EXCEPTIONS).filter(isBag).map((exception) => {
    const out: Bag = {
      type: typeof exception.type === "string" && ERROR_TYPE.test(exception.type) ? exception.type : "Error",
    };
    const mechanism = cleanMechanism(exception.mechanism);
    if (typeof exception.value === "string") {
      out.value = mechanism?.synthetic === true ? syntheticValue(exception.value) : redactErrorMessage(exception.value);
    }
    if (mechanism) out.mechanism = mechanism;
    const frames = framesOf(exception)
      .slice(-MAX_FRAMES)
      .map(cleanFrame)
      .filter((frame): frame is Bag => frame !== null);
    if (frames.length > 0) out.stacktrace = { type: "raw", frames };
    return out;
  });
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
  if (exceptionTouchesAdmin(properties[EXCEPTION_LIST])) return null;
  // An error report with nothing left to report isn't sent.
  if (EXCEPTION_LIST in properties) {
    const list = properties[EXCEPTION_LIST];
    if (!Array.isArray(list) || !list.slice(0, MAX_EXCEPTIONS).some(isBag)) return null;
  }
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

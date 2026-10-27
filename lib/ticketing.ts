/**
 * External ticketing (docs/architecture.md, "External ticketing"): an event
 * whose tickets are sold on another site, which Sheltüh lists and links to.
 *
 * Shared by the API (lib/server/event-input.ts, records.ts) and the browser
 * (the event editor, the admin queue, the event page), so it imports nothing
 * from Node and nothing server-only: only the global URL parser.
 */

/** `sheltuh`: tickets sold here (the default). `external`: a link to another ticketing site. */
export type TicketingMode = "sheltuh" | "external";

export const TICKETING_MODES: readonly TicketingMode[] = ["sheltuh", "external"];

/**
 * Whether an event sells paid tickets through Sheltüh: it isn't external (a
 * missing mode is "sheltuh") and a ticket type costs more than 0. Such an
 * event can't be submitted or published until its organiser's payouts are set
 * up (lib/api/events.ts, PAYOUTS_REQUIRED_CODE); free and external events
 * never need them.
 */
export function sellsPaidTicketsOnSheltuh(event: {
  ticketingMode?: TicketingMode;
  ticketTypes: readonly { priceCents: number }[];
}): boolean {
  return event.ticketingMode !== "external" && event.ticketTypes.some((ticket) => ticket.priceCents > 0);
}

/** Longest ticket link accepted (matches the events.external_ticket_url check constraint). */
export const MAX_EXTERNAL_TICKET_URL_LENGTH = 2048;

/**
 * Control, invisible-format, separator and whitespace characters (NUL
 * included), and backslashes, which URL parsers read as "/" (so
 * "https://a.example\@b.example" goes to a.example while reading like
 * b.example). None belong in a URL as typed. Same rule as the organiser
 * website (lib/server/validation.ts, optionalUrl).
 */
export const URL_DISALLOWED = /[\p{Cc}\p{Cf}\p{Z}\s\\]/u;

/**
 * Redirect services (shorteners, link-in-bio and smart-link pages): a link
 * through one could be pointed somewhere else after an admin approved it, so
 * the reviewed URL wouldn't be where buyers go. Matched on the host and any
 * subdomain of it. Only a speed bump: any domain an organiser controls can be
 * re-pointed too, so admin review and unpublishing are the real control
 * (docs/architecture.md, "Accepted risks (external ticketing)"). The same
 * list is in private.external_ticket_url_ok
 * (supabase/migrations/20261022000200_external_ticketing_hardening.sql).
 */
export const LINK_SHORTENER_HOSTS: readonly string[] = [
  "adf.ly",
  "bit.do",
  "bit.ly",
  "bitly.com",
  "bl.ink",
  "buff.ly",
  "cutt.ly",
  "dlvr.it",
  "dub.sh",
  "fb.me",
  "ffm.to",
  "goo.gl",
  "ht.ly",
  "ift.tt",
  "is.gd",
  "j.mp",
  "linktr.ee",
  "lnk.to",
  "lnkd.in",
  "ow.ly",
  "qrco.de",
  "rb.gy",
  "rebrand.ly",
  "rotf.lol",
  "s.id",
  "short.io",
  "shorturl.at",
  "smarturl.it",
  "t.co",
  "t.ly",
  "tiny.cc",
  "tiny.one",
  "tinyurl.com",
  "trib.al",
  "v.gd",
];

/**
 * Names that never reach a public site: localhost, mDNS (.local), ICANN's
 * private-use .internal, home networks (home.arpa, .lan, .localdomain), the
 * reserved test names (.test, .invalid, .example) and Tor (.onion). Matched
 * on the host and any subdomain of it. The same list is in the
 * events_external_ticket_url_valid check constraint
 * (supabase/migrations/20261022000000_external_ticketing.sql).
 */
export const NON_PUBLIC_HOST_SUFFIXES: readonly string[] = [
  "localhost",
  "local",
  "internal",
  "localdomain",
  "home.arpa",
  "lan",
  "test",
  "invalid",
  "example",
  "onion",
];

/**
 * Ticketing sites shown by name (`ticketProviderName`). Matched on the host
 * and any subdomain of it. Anything else is shown as "the organiser's site"
 * (owner decision, docs/design/home.md).
 */
export const KNOWN_TICKETING_HOSTS: readonly { label: string; domains: readonly string[] }[] = [
  { label: "Humanitix", domains: ["humanitix.com", "humanitix.com.au"] },
  {
    label: "Eventbrite",
    domains: ["eventbrite.com", "eventbrite.com.au", "eventbrite.co.nz", "eventbrite.co.uk", "eventbrite.ca", "eventbrite.ie"],
  },
  { label: "Moshtix", domains: ["moshtix.com.au", "moshtix.co.nz"] },
  { label: "Oztix", domains: ["oztix.com.au"] },
  { label: "Ticketek", domains: ["ticketek.com.au", "ticketek.co.nz"] },
  {
    label: "Ticketmaster",
    domains: ["ticketmaster.com.au", "ticketmaster.co.nz", "ticketmaster.com", "ticketmaster.co.uk"],
  },
  { label: "TryBooking", domains: ["trybooking.com"] },
  { label: "DICE", domains: ["dice.fm"] },
  { label: "Resident Advisor", domains: ["ra.co", "residentadvisor.net"] },
  { label: "Luma", domains: ["lu.ma", "luma.com"] },
  { label: "Peatix", domains: ["peatix.com"] },
];

/** `host` is `domain` or a subdomain of it (never merely ending in the same letters). */
function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isLinkShortener(host: string): boolean {
  const h = host.toLowerCase();
  return LINK_SHORTENER_HOSTS.some((domain) => hostIs(h, domain));
}

/** `host` is localhost or under one of NON_PUBLIC_HOST_SUFFIXES. */
export function isNonPublicHost(host: string): boolean {
  const h = host.toLowerCase();
  return NON_PUBLIC_HOST_SUFFIXES.some((domain) => hostIs(h, domain));
}

/**
 * A host as the URL parser writes it, restricted to DNS names: lower-case
 * letters, digits and hyphens in at least two dot-separated labels (an
 * international name is punycode by then). The parser itself lets through
 * characters such as `!`, `_` or `*` in a host; none belong in a ticket
 * site's name. Matches the database check.
 */
const DNS_HOST = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Why a ticket link was refused. */
export type ExternalTicketUrlProblem =
  | "too_long"
  | "not_https"
  | "invalid"
  | "credentials"
  | "port"
  | "ip_address"
  | "localhost"
  | "single_label"
  | "shortener";

export type ExternalTicketUrlCheck =
  | { ok: true; /** The URL as the browser's parser writes it (lower-case host, punycode), which is what's stored. */ url: string }
  | { ok: false; problem: ExternalTicketUrlProblem; message: string };

const MESSAGES: Record<ExternalTicketUrlProblem, string> = {
  too_long: `Must be ${MAX_EXTERNAL_TICKET_URL_LENGTH} characters or fewer.`,
  not_https: "Use the ticket page's secure address, starting with https://",
  invalid: "Enter the ticket page's full address, starting with https://",
  credentials: "Enter the address without a username or password.",
  port: "Enter the address without a port number.",
  ip_address: "Use the ticket site's name, not an IP address.",
  localhost: "Enter a public ticket page.",
  single_label: "Enter the ticket site's full name, e.g. www.example.com.au.",
  shortener: "Link shorteners and link-in-bio pages can't be used. Paste the ticket page's full address.",
};

function refuse(problem: ExternalTicketUrlProblem): ExternalTicketUrlCheck {
  return { ok: false, problem, message: MESSAGES[problem] };
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Checks a ticket link an organiser typed. The organiser website's rules
 * (https only as typed, no username or password, none of URL_DISALLOWED),
 * and also: no IP-address host, no single-label host (`https://tickets/`),
 * no localhost or other non-public name (NON_PUBLIC_HOST_SUFFIXES), no
 * explicit port, a plain DNS host, and no link shortener. Any other host is
 * allowed: the link is reviewed by an admin before the event is published,
 * and after that only an admin can change it (docs/architecture.md,
 * "External ticketing").
 *
 * Returns the parser's form of the URL, which is what should be stored: its
 * host is lower case and an international domain name is punycode
 * (`xn--…`), so lookalike letters can't hide in what the admin reviews.
 */
export function checkExternalTicketUrl(value: string): ExternalTicketUrlCheck {
  const trimmed = value.trim();
  if (trimmed.length > MAX_EXTERNAL_TICKET_URL_LENGTH) return refuse("too_long");
  if (/^http:\/\//i.test(trimmed)) return refuse("not_https");
  if (!/^https:\/\//i.test(trimmed) || URL_DISALLOWED.test(trimmed)) return refuse("invalid");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return refuse("invalid");
  }
  if (url.protocol !== "https:") return refuse("invalid");

  // The authority as typed (up to the first / ? or #), as well as the parser's view.
  const authority = trimmed.slice("https://".length).split(/[/?#]/, 1)[0];
  if (authority.includes("@") || url.username || url.password) return refuse("credentials");

  const host = url.hostname;
  if (!host) return refuse("invalid");
  // IPv6 literals ([::1]) and IPv4 in any form the parser accepts (it
  // normalises 0x7f.1 and 2130706433 to 127.0.0.1).
  if (host.startsWith("[") || IPV4.test(host)) return refuse("ip_address");
  // Any colon left in the typed authority is a port (IPv6 is refused above);
  // the parser drops a default one (:443), so the typed form is checked too.
  if (authority.includes(":") || url.port) return refuse("port");
  if (isNonPublicHost(host)) return refuse("localhost");
  // A trailing dot (example.com.) is a valid but unusual spelling that would
  // slip past the host checks below.
  if (host.endsWith(".") || host.startsWith(".") || host.includes("..")) return refuse("invalid");
  if (!host.includes(".")) return refuse("single_label");
  if (!DNS_HOST.test(host)) return refuse("invalid");
  if (isLinkShortener(host)) return refuse("shortener");

  if (url.href.length > MAX_EXTERNAL_TICKET_URL_LENGTH) return refuse("too_long");
  return { ok: true, url: url.href };
}

/** How a ticket link's site is shown. */
export interface TicketHost {
  /** The URL's host, lower case, international names in punycode. */
  host: string;
  /** A known ticketing site's name (e.g. "Humanitix"), else the host without a leading "www.". Punycode hosts: the raw host. */
  hostLabel: string;
  /** The host has a punycode (`xn--`) label: an international name, which can imitate another site's. Admins should check it. */
  punycode: boolean;
  /** hostLabel is a known ticketing site's name. */
  known: boolean;
}

/**
 * The ticketing site's name for "Get tickets on {provider}": a known site's
 * name (Humanitix, Eventbrite, ...), else null, which the UI shows as "the
 * organiser's site" rather than the bare host (owner decision 4,
 * docs/design/home.md). An international (punycode) host is always null.
 */
export function ticketProviderName(url: string): string | null {
  const described = describeTicketHost(url);
  return described?.known ? described.hostLabel : null;
}

/** Describes a stored (already checked) ticket link's site; null if it can't be parsed. */
export function describeTicketHost(value: string): TicketHost | null {
  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host) return null;
  const punycode = host.split(".").some((label) => label.startsWith("xn--"));
  if (punycode) return { host, hostLabel: host, punycode: true, known: false };
  const known = KNOWN_TICKETING_HOSTS.find((site) => site.domains.some((domain) => hostIs(host, domain)));
  if (known) return { host, hostLabel: known.label, punycode: false, known: true };
  return { host, hostLabel: host.replace(/^www\./, ""), punycode: false, known: false };
}

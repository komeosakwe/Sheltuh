import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/lib/server/db";
import {
  checkExternalTicketUrl,
  describeTicketHost,
  LINK_SHORTENER_HOSTS,
  MAX_EXTERNAL_TICKET_URL_LENGTH,
  NON_PUBLIC_HOST_SUFFIXES,
  ticketProviderName,
  type ExternalTicketUrlProblem,
} from "@/lib/ticketing";
import { createTestDb } from "./helpers/test-db";

/**
 * The external ticket link's rules (lib/ticketing.ts, checkExternalTicketUrl)
 * and the database's own check (private.external_ticket_url_ok, behind the
 * events_external_ticket_url_valid constraint), which must agree: every link
 * the API stores passes the database, and every link class the API refuses
 * that the database can recognise in its stored form is refused there too.
 */

let db: Db;

beforeAll(async () => {
  db = (await createTestDb()).db;
});

async function dbAccepts(url: string): Promise<boolean> {
  const [row] = await db.query<{ ok: boolean | null }>(`select private.external_ticket_url_ok($1) as ok`, [url]);
  return row.ok === true;
}

const ACCEPTED: [input: string, stored: string][] = [
  ["https://events.humanitix.com/neon-static", "https://events.humanitix.com/neon-static"],
  ["https://www.eventbrite.com.au/e/neon-static-tickets-123?aff=ig#tickets", "https://www.eventbrite.com.au/e/neon-static-tickets-123?aff=ig#tickets"],
  // Trimmed; scheme and host lower-cased; the path keeps its case.
  ["  HTTPS://Humanitix.COM/Neon-Static  ", "https://humanitix.com/Neon-Static"],
  // No path: the parser adds "/".
  ["https://dice.fm", "https://dice.fm/"],
  // An international name is stored as punycode, so lookalikes are visible to the reviewing admin.
  ["https://bücher.de/tickets", "https://xn--bcher-kva.de/tickets"],
  // Non-ASCII in the path is percent-encoded.
  ["https://www.trybooking.com/événement", "https://www.trybooking.com/%C3%A9v%C3%A9nement"],
  // A default port the parser drops, typed without one.
  ["https://tickets.my-venue.com.au/show/1", "https://tickets.my-venue.com.au/show/1"],
  // Only the exact shortener domains and their subdomains are refused.
  ["https://rabbit.ly/tickets", "https://rabbit.ly/tickets"],
  ["https://notbit.ly/tickets", "https://notbit.ly/tickets"],
  ["https://t.com.au/tickets", "https://t.com.au/tickets"],
  // example.com is a normal (documentation) domain; only the .example TLD is reserved.
  ["https://www.example.com/rsvp", "https://www.example.com/rsvp"],
  // Digits or "0x" inside a label are fine; only a numeric last label is an address.
  ["https://events.0xfoo.com/1", "https://events.0xfoo.com/1"],
  ["https://123tix.com.au/1", "https://123tix.com.au/1"],
  // Exactly at the length cap.
  [
    `https://a.com/${"x".repeat(MAX_EXTERNAL_TICKET_URL_LENGTH - "https://a.com/".length)}`,
    `https://a.com/${"x".repeat(MAX_EXTERNAL_TICKET_URL_LENGTH - "https://a.com/".length)}`,
  ],
];

const REFUSED: [input: string, problem: ExternalTicketUrlProblem][] = [
  ["http://humanitix.com/neon", "not_https"],
  ["HTTP://humanitix.com/neon", "not_https"],
  ["ftp://humanitix.com/neon", "invalid"],
  ["humanitix.com/neon", "invalid"],
  ["//humanitix.com/neon", "invalid"],
  ["javascript:alert(1)", "invalid"],
  ["data:text/html,hi", "invalid"],
  ["", "invalid"],
  ["https://", "invalid"],
  // Credentials, including the "reads as one site, goes to another" trick.
  ["https://user:pass@humanitix.com/", "credentials"],
  ["https://user@humanitix.com/", "credentials"],
  ["https://humanitix.com@evil.com/", "credentials"],
  // Ports, including the default one (the parser would drop it silently).
  ["https://humanitix.com:8443/", "port"],
  ["https://humanitix.com:443/", "port"],
  ["https://humanitix.com:/", "port"],
  // IP addresses, in every form the parser accepts.
  ["https://127.0.0.1/", "ip_address"],
  ["https://10.0.0.1/tickets", "ip_address"],
  ["https://2130706433/", "ip_address"],
  ["https://0x7f.1/", "ip_address"],
  ["https://0x7f.0.0.1/", "ip_address"],
  ["https://0177.0.0.1/", "ip_address"],
  // A numeric last label makes the parser read the host as IPv4, and fail.
  ["https://foo.0x7f/", "invalid"],
  ["https://example.123/", "invalid"],
  ["https://[::1]/", "ip_address"],
  ["https://[2001:db8::1]/tickets", "ip_address"],
  ["https://[::ffff:127.0.0.1]/", "ip_address"],
  // Names that never reach a public site.
  ["https://localhost/", "localhost"],
  ["https://LOCALHOST/", "localhost"],
  ["https://tickets.localhost/", "localhost"],
  ["https://printer.local/", "localhost"],
  ["https://svc.internal/tickets", "localhost"],
  ["https://nas.localdomain/", "localhost"],
  ["https://router.home.arpa/", "localhost"],
  ["https://box.lan/", "localhost"],
  ["https://site.test/", "localhost"],
  ["https://site.invalid/", "localhost"],
  ["https://site.example/", "localhost"],
  ["https://abcdefghijklmnop.onion/", "localhost"],
  ["https://tickets/", "single_label"],
  // Hosts that aren't plain DNS names.
  ["https://my_venue.com/", "invalid"],
  ["https://a!b.com/", "invalid"],
  ["https://a*b.com/", "invalid"],
  ["https://humanitix.com./", "invalid"],
  ["https://.humanitix.com/", "invalid"],
  // Whitespace, control and invisible characters, backslashes.
  ["https://humanitix.com/neon static", "invalid"],
  ["https://humanitix.com/neon\tstatic", "invalid"],
  ["https://humanitix.com/\u0000", "invalid"],
  ["https://humanitix.com/\u200bneon", "invalid"],
  ["https://humanitix.com/\u202eneon", "invalid"],
  ["https://humanitix.com\\@evil.com/", "invalid"],
  ["https://humanitix.com/a\u00a0b", "invalid"],
  // Link shorteners, and subdomains of them.
  ["https://bit.ly/3xYz", "shortener"],
  ["https://BIT.LY/3xYz", "shortener"],
  ["https://tinyurl.com/abc", "shortener"],
  ["https://t.co/abc", "shortener"],
  ["https://goo.gl/abc", "shortener"],
  ["https://ow.ly/abc", "shortener"],
  ["https://buff.ly/abc", "shortener"],
  ["https://rebrand.ly/abc", "shortener"],
  ["https://is.gd/abc", "shortener"],
  ["https://cutt.ly/abc", "shortener"],
  ["https://shorturl.at/abc", "shortener"],
  ["https://lnkd.in/abc", "shortener"],
  ["https://www.bit.ly/abc", "shortener"],
  // Too long.
  [`https://a.com/${"x".repeat(MAX_EXTERNAL_TICKET_URL_LENGTH)}`, "too_long"],
];

describe("checkExternalTicketUrl", () => {
  it.each(ACCEPTED)("accepts %j, stored as the parser writes it", (input, stored) => {
    expect(checkExternalTicketUrl(input)).toEqual({ ok: true, url: stored });
  });

  it.each(REFUSED)("refuses %j (%s) with a message", (input, problem) => {
    const result = checkExternalTicketUrl(input);
    expect(result).toMatchObject({ ok: false, problem });
    if (!result.ok) expect(result.message.length).toBeGreaterThan(10);
  });

  it("refuses a link that only passes the cap before the parser encodes it", () => {
    // 2040 characters typed, but each "é" becomes 6 once percent-encoded.
    const typed = `https://a.com/${"é".repeat(300)}${"x".repeat(MAX_EXTERNAL_TICKET_URL_LENGTH - 314 - 300)}`;
    expect(typed.length).toBeLessThanOrEqual(MAX_EXTERNAL_TICKET_URL_LENGTH);
    expect(checkExternalTicketUrl(typed)).toMatchObject({ ok: false, problem: "too_long" });
  });

  it("refuses every listed shortener and non-public name, and their subdomains", () => {
    for (const host of LINK_SHORTENER_HOSTS) {
      expect(checkExternalTicketUrl(`https://${host}/x`), host).toMatchObject({ ok: false, problem: "shortener" });
      expect(checkExternalTicketUrl(`https://go.${host}/x`), host).toMatchObject({ ok: false, problem: "shortener" });
    }
    for (const suffix of NON_PUBLIC_HOST_SUFFIXES) {
      expect(checkExternalTicketUrl(`https://box.${suffix}/x`), suffix).toMatchObject({ ok: false, problem: "localhost" });
    }
  });
});

describe("ticketProviderName", () => {
  it.each([
    ["https://humanitix.com/x", "Humanitix"],
    ["https://events.humanitix.com/x", "Humanitix"],
    ["https://www.eventbrite.com/e/1", "Eventbrite"],
    ["https://www.eventbrite.com.au/e/1", "Eventbrite"],
    ["https://www.trybooking.com/ABCD", "TryBooking"],
    ["https://www.moshtix.com.au/v2/event/1", "Moshtix"],
    ["https://www.oztix.com.au/1", "Oztix"],
    ["https://premier.ticketek.com.au/shows/1", "Ticketek"],
    ["https://www.ticketmaster.com.au/event/1", "Ticketmaster"],
    ["https://dice.fm/event/1", "DICE"],
  ])("names %s as %s", (url, name) => {
    expect(ticketProviderName(url)).toBe(name);
  });

  it("is null for any other site, a lookalike, a punycode host, or something unparseable", () => {
    expect(ticketProviderName("https://www.my-venue.com.au/tickets")).toBeNull();
    expect(ticketProviderName("https://nothumanitix.com/x")).toBeNull();
    expect(ticketProviderName("https://humanitix.com.evil.com/x")).toBeNull();
    expect(ticketProviderName("https://xn--humntix-3ya.com/x")).toBeNull();
    expect(ticketProviderName("not a url")).toBeNull();
    expect(describeTicketHost("https://xn--bcher-kva.de/")).toMatchObject({ punycode: true, known: false });
  });
});

describe("the database's check agrees with the API's", () => {
  it("accepts every link the API stores", async () => {
    for (const [input] of ACCEPTED) {
      const checked = checkExternalTicketUrl(input);
      if (!checked.ok) throw new Error(`expected ${input} to be accepted`);
      expect(await dbAccepts(checked.url), checked.url).toBe(true);
    }
  });

  it("refuses each refused class in the form it would be stored in", async () => {
    const stored = [
      "http://humanitix.com/neon",
      "ftp://humanitix.com/neon",
      "https://user:pass@humanitix.com/",
      "https://humanitix.com@evil.com/",
      "https://humanitix.com:8443/",
      "https://127.0.0.1/",
      "https://10.0.0.1/tickets",
      // IPv4 in hex, octal or mixed forms, or a numeric last label: written
      // around the API (whose parser normalises or rejects them).
      "https://0x7f.1/",
      "https://0x7f.0.0.1/",
      "https://0177.0.0.1/",
      "https://foo.0x7f/",
      "https://foo.0x/",
      "https://example.123/",
      "https://[::1]/",
      "https://localhost/",
      "https://tickets/",
      "https://my_venue.com/",
      "https://humanitix.com./",
      "https://humanitix.com/neon static",
      "https://humanitix.com/\u200bneon",
      "https://humanitix.com\\@evil.com/",
      "https://Humanitix.com/",
      `https://a.com/${"x".repeat(MAX_EXTERNAL_TICKET_URL_LENGTH)}`,
      "",
    ];
    for (const url of stored) expect(await dbAccepts(url), JSON.stringify(url)).toBe(false);
  });

  it("refuses every listed shortener and non-public name (the lists are in sync)", async () => {
    for (const host of LINK_SHORTENER_HOSTS) {
      expect(await dbAccepts(`https://${host}/x`), host).toBe(false);
      expect(await dbAccepts(`https://go.${host}/x`), host).toBe(false);
      // Only that domain: a longer name ending in the same letters is fine.
      expect(await dbAccepts(`https://x${host}/x`), `x${host}`).toBe(true);
    }
    for (const suffix of NON_PUBLIC_HOST_SUFFIXES) {
      expect(await dbAccepts(`https://box.${suffix}/x`), suffix).toBe(false);
    }
  });
});

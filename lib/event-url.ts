/**
 * An event page's public address, for sharing and calendars: the origin and
 * `/events/{slug}` only. No query string or fragment, so a tracking link's
 * `?ref=` (or anything else in the address bar) is never passed on, and one
 * buyer's attribution isn't credited to whoever they share it with
 * (docs/design/brand-direction-one.md §6.7).
 */
export function publicEventUrl(slug: string, origin: string): string {
  return `${origin.replace(/\/+$/, "")}/events/${encodeURIComponent(slug)}`;
}

/**
 * An external event's ticket link may be rendered: only an https link ever
 * is. The API already refuses anything else (lib/ticketing.ts,
 * checkExternalTicketUrl, and a database check), so this is defence in
 * depth: a `javascript:` or plain-http link can't reach the page even if bad
 * data did. (A plain module, so the server-rendered event page can call it.)
 */
export function isSafeTicketUrl(url: string | undefined): url is string {
  return typeof url === "string" && url.startsWith("https://");
}

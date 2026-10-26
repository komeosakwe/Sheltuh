import { HttpError, okPublic } from "../http";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import { EVENT_SELECT, toPublicEventFromRow } from "../records";
import type { Handler } from "../route";
import { EVENT_CATEGORIES, type EventCategory } from "../types";
import { upcomingPageCte } from "../upcoming-page";

/**
 * The feed (GET /api/events): the same for every caller (no handler here
 * reads a token), so the CDN may share it. Fresh for a minute, then served
 * stale for up to two more while it revalidates; browsers revalidate every
 * time (max-age=0). So a change (a new, edited, sold-out or unpublished
 * event) can take up to about 3 minutes to show: docs/architecture.md, "CDN
 * windows". Checkout and fulfilment always read the database.
 */
export const PUBLIC_EVENTS_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=120";

/**
 * One event by slug (the event and seat pages): a shorter window than the
 * feed, since the page shows what's left ("Only N left", sold out) and caps
 * the quantity. At most about a minute stale.
 */
export const PUBLIC_EVENT_CACHE_CONTROL = "public, max-age=0, s-maxage=15, stale-while-revalidate=45";

/** "YYYY-MM-DD" (already pattern-checked) is a real calendar date: not 2026-02-30. */
function isCalendarDate(text: string): boolean {
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * GET /api/events — public, unauthenticated. Every query here is pinned to
 * status = 'published'; nothing else is reachable through these routes.
 * Nothing reads the caller: 200s are shared at the CDN
 * (PUBLIC_EVENTS_CACHE_CONTROL); errors are `private, no-store`.
 */
export const listPublicEvents: Handler = async (req, _params, { db }) => {
  const qs = new URL(req.url).searchParams;
  const where = [`e.status = 'published'`];
  const params: unknown[] = [];

  const category = qs.get("category");
  if (category) {
    if (!EVENT_CATEGORIES.includes(category as EventCategory)) {
      throw new HttpError(400, `category must be one of: ${EVENT_CATEGORIES.join(", ")}`);
    }
    params.push(category);
    where.push(`e.category = $${params.length}::public.event_category`);
  }

  const pricing = qs.get("pricing");
  if (pricing) {
    if (pricing !== "free" && pricing !== "paid") throw new HttpError(400, "pricing must be 'free' or 'paid'.");
    // An event with no ticket types yet is neither: is_free is false for it
    // (private.replace_ticket_types), and it has no paid ticket type either.
    // The paid check is an index lookup on ticket_types' (event_id, id) key.
    where.push(
      pricing === "free"
        ? "e.is_free"
        : "exists (select 1 from public.ticket_types t where t.event_id = e.id and t.price_cents > 0)",
    );
  }

  // Events starting on or after the date in their own zone. The local date
  // can't use an index, so a coarse bound a day earlier on starts_at itself
  // (no Australian zone is a day or more ahead of UTC) lets
  // events_status_starts_idx skip what's long gone; the exact test follows.
  const onOrAfter = qs.get("onOrAfter");
  if (onOrAfter) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(onOrAfter)) throw new HttpError(400, "onOrAfter must be formatted YYYY-MM-DD.");
    if (!isCalendarDate(onOrAfter)) throw new HttpError(400, "onOrAfter is not a valid date.");
    params.push(onOrAfter);
    const n = params.length;
    where.push(
      `e.starts_at >= (($${n}::date - 1)::timestamp at time zone 'UTC')`,
      `(e.starts_at at time zone e.time_zone)::date >= $${n}::date`,
    );
  }

  // Only events that haven't ended yet (in progress included). The order
  // below is already soonest first, so the offset cursor stays consistent:
  // each page re-applies the same filter and order. An event that ends
  // between two page loads drops out and shifts later rows up by one, as any
  // change to the feed does with an offset cursor. Absent, empty, 0 or false
  // means every published event (the original behaviour); anything else is a
  // 400. The page's ids come first (upcomingPageCte: in progress through
  // events_status_ends_idx, not started through events_status_starts_idx).
  const upcomingParam = qs.get("upcoming");
  let upcoming = false;
  if (upcomingParam !== null && upcomingParam !== "") {
    if (upcomingParam === "1" || upcomingParam === "true") upcoming = true;
    else if (upcomingParam !== "0" && upcomingParam !== "false") throw new HttpError(400, "upcoming must be 1 or 0.");
  }

  // Free-text search over title, venue, suburb, organiser and description.
  // LIKE wildcards in the user's text are escaped so they match literally.
  const q = qs.get("q")?.trim().slice(0, 100);
  if (q) {
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const n = params.length;
    where.push(
      `(e.title ilike $${n} or e.venue_name ilike $${n} or e.suburb ilike $${n}
        or o.display_name ilike $${n} or e.description ilike $${n})`,
    );
  }

  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  params.push(limit + 1, offset);

  const limitParam = `$${params.length - 1}`;
  const offsetParam = `$${params.length}`;
  const rows = await db.query(
    upcoming
      ? `${upcomingPageCte(where.join(" and "), limitParam, offsetParam)}
         ${EVENT_SELECT} join page p on p.id = e.id
         order by e.starts_at, e.id`
      : `${EVENT_SELECT} where ${where.join(" and ")}
         order by e.starts_at, e.id limit ${limitParam} offset ${offsetParam}`,
    params,
  );
  return okPublic(toPage(rows.map(toPublicEventFromRow), offset, limit), PUBLIC_EVENTS_CACHE_CONTROL);
};

/**
 * GET /api/events/slug/[slug] — public; a slug that's been unpublished is a
 * 404 (never cached, so a newly published event shows at once). A 200 is
 * shared at the CDN (PUBLIC_EVENT_CACHE_CONTROL).
 */
export const getPublicEventBySlug: Handler<{ slug: string }> = async (_req, { slug }, { db }) => {
  const [row] = await db.query(`${EVENT_SELECT} where e.slug = $1 and e.status = 'published'`, [slug]);
  if (!row) throw new HttpError(404, "Event not found.");
  return okPublic(toPublicEventFromRow(row), PUBLIC_EVENT_CACHE_CONTROL);
};

import { isApiConfigured } from "@/lib/api/client";
import { buildIcs, icsFilename, type CalendarEvent } from "@/lib/calendar";
import { getEventBySlug } from "@/lib/data";
import { publicEventUrl } from "@/lib/event-url";
import { errorJson, HttpError } from "../http";
import { route, type Handler } from "../route";

/**
 * GET /events/{slug}/calendar.ics: the event as an iCalendar file at a stable
 * URL (docs/design/brand-direction-one.md §6.7). Served `inline` as
 * text/calendar, so iOS Safari opens its "Add to Calendar" sheet and desktop
 * browsers hand it to the calendar app, rather than a phone saving a file.
 *
 * Public, with the event page's visibility: in live mode a published event
 * only (anything else, or an unknown slug, is the same 404); in demo mode
 * (no Supabase configured) the sample events. The file holds only what the
 * public event page shows: no organiser, order or personal data.
 */

/**
 * Short enough for a takedown (unpublish) or an edit to reach calendars soon;
 * DTSTAMP is the response time. Five minutes in browsers and at the CDN
 * (`s-maxage`: without it a shared cache such as Vercel's may not keep it);
 * the file is the same for everyone.
 */
export const CALENDAR_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

const NOT_FOUND = "Event not found.";

/** The file's name for Content-Disposition: slugs are `[a-z0-9-]` already; anything else is replaced, never quoted. */
function headerFilename(event: Pick<CalendarEvent, "slug">): string {
  return icsFilename(event).replace(/[^A-Za-z0-9._-]/g, "-");
}

/** The .ics response for an event whose page is at `origin`; a 404 if its start can't be read. */
export function icsResponse(event: CalendarEvent, origin: string, now: Date = new Date()): Response {
  const ics = buildIcs(event, { url: publicEventUrl(event.slug, origin), now });
  if (ics === null) throw new HttpError(404, NOT_FOUND);
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${headerFilename(event)}"`,
      "cache-control": CALENDAR_CACHE_CONTROL,
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * Live mode. Only the columns the file needs; `events.slug` is unique (its
 * index serves the lookup). The page link is the configured site URL
 * (NEXT_PUBLIC_SITE_URL, as every other link the server builds), never the
 * request's Host header, since the response may be cached publicly.
 */
export const getEventCalendar: Handler<{ slug: string }> = async (_req, { slug }, { db, siteUrl }) => {
  const [row] = await db.query<{
    id: string;
    slug: string;
    title: string;
    description: string;
    venue_name: string;
    venue_address: string;
    starts_at: string | Date;
    ends_at: string | Date | null;
  }>(
    `select e.id, e.slug, e.title, e.description, e.venue_name, e.venue_address, e.starts_at, e.ends_at
       from public.events e
      where e.slug = $1 and e.status = 'published'`,
    [slug],
  );
  if (!row) throw new HttpError(404, NOT_FOUND);
  return icsResponse(
    {
      id: row.id,
      slug: row.slug,
      title: row.title,
      description: row.description,
      venueName: row.venue_name,
      venueAddress: row.venue_address,
      startsAt: new Date(row.starts_at).toISOString(),
      endsAt: row.ends_at === null ? undefined : new Date(row.ends_at).toISOString(),
    },
    siteUrl(),
  );
};

/**
 * Demo mode: the sample events, as the demo event page shows them. The page
 * link is the request's own origin: a demo deployment's events exist only
 * there, whatever NEXT_PUBLIC_SITE_URL says.
 */
export async function getDemoEventCalendar(req: Request, { slug }: { slug: string }): Promise<Response> {
  const event = await getEventBySlug(slug);
  try {
    if (!event) throw new HttpError(404, NOT_FOUND);
    return icsResponse(event, new URL(req.url).origin);
  } catch (err) {
    if (err instanceof HttpError) return errorJson(err.statusCode, { error: err.message });
    throw err;
  }
}

const liveEventCalendar = route(getEventCalendar);

/** The route export (app/events/[slug]/calendar.ics/route.ts): demo or live, as the event page decides. */
export async function eventCalendarRoute(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  if (!isApiConfigured) return getDemoEventCalendar(req, await ctx.params);
  return liveEventCalendar(req, ctx);
}

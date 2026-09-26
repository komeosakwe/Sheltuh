import { HttpError, ok } from "../http";
import { melbourneLocalToUtcIso } from "../melbourne-time";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import { EVENT_SELECT, toEvent, toPublicEvent } from "../records";
import type { Handler } from "../route";
import { EVENT_CATEGORIES, type EventCategory } from "../types";

/**
 * GET /api/events — public, unauthenticated. Every query here is pinned to
 * status = 'published'; nothing else is reachable through these routes.
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
    where.push(pricing === "free" ? "e.is_free" : "not e.is_free");
  }

  const onOrAfter = qs.get("onOrAfter");
  if (onOrAfter) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(onOrAfter)) throw new HttpError(400, "onOrAfter must be formatted YYYY-MM-DD.");
    let floor: string;
    try {
      floor = melbourneLocalToUtcIso(onOrAfter, "00:00");
    } catch {
      throw new HttpError(400, "onOrAfter is not a valid date.");
    }
    params.push(floor);
    where.push(`e.starts_at >= $${params.length}`);
  }

  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  params.push(limit + 1, offset);

  const rows = await db.query(
    `${EVENT_SELECT} where ${where.join(" and ")}
     order by e.starts_at, e.id limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return ok(toPage(rows.map((row) => toPublicEvent(toEvent(row))), offset, limit));
};

/** GET /api/events/slug/[slug] — public; a slug that's been unpublished is a 404. */
export const getPublicEventBySlug: Handler<{ slug: string }> = async (_req, { slug }, { db }) => {
  const [row] = await db.query(`${EVENT_SELECT} where e.slug = $1 and e.status = 'published'`, [slug]);
  if (!row) throw new HttpError(404, "Event not found.");
  return ok(toPublicEvent(toEvent(row)));
};

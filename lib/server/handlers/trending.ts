import { requireAdmin } from "../auth";
import { requireCronSecret } from "../cron-auth";
import type { Db } from "../db";
import { HttpError, okPrivate, readJson } from "../http";
import { parseMessageText } from "../message-input";
import { isUuid } from "../pagination";
import { eventSelectWith, toEvent, toPublicEventFromRow } from "../records";
import type { Handler } from "../route";
import { fail } from "../validation";
import { OPEN as WHOS_GOING_OPEN, SUSPENDED_ATTENDEE } from "./going";
import {
  MAX_TRENDING_BOOST,
  MIN_TRENDING_BOOST,
  TRENDING_GOING_THRESHOLD,
  type CurationLogEntry,
  type EventCuration,
  type TrendingEvent,
  type TrendingResponse,
} from "@/lib/api/trending";

/**
 * Trending (docs/architecture.md, "Trending"). The score is computed in the
 * database (private.refresh_trending, supabase/migrations/20261023000000_trending.sql)
 * into a snapshot; these routes refresh it, serve it and let admins curate it.
 */

/** Below this many events still eligible at read time, the list is empty (the home hides the section). */
export const TRENDING_MIN_ITEMS = 3;
/** "Just announced": first approved at most this long ago. */
export const JUST_ANNOUNCED_MS = 72 * 60 * 60 * 1000;
/**
 * Not personalised, so the CDN may share it: fresh for 5 minutes, then
 * served stale for up to 10 more while it revalidates. Browsers revalidate
 * every time (max-age=0). The snapshot itself can be a day old (the cron is
 * daily on Vercel's Hobby plan); the read-time checks below keep it correct.
 */
export const TRENDING_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=600";
/** Longest curation reason (as the ticketing change's). */
export const MAX_CURATION_REASON_LENGTH = 500;
/** Curation log entries returned, newest first. */
const CURATION_LOG_LIMIT = 20;

const EVENT_NOT_FOUND = "Event not found.";

/**
 * GET /api/events/trending — public. The snapshot's events, best first, that
 * are still eligible now: published, not ended, organiser approved, not
 * excluded by an admin. Fewer than TRENDING_MIN_ITEMS left: `items: []`.
 * Each carries a label, never a raw count: "going" (with the Who's Going
 * count, only while Who's Going is open and at least
 * TRENDING_GOING_THRESHOLD are going; never for an external event, whose Who's
 * Going is always closed), else "just-announced" (first approved within 72
 * hours), else "popular".
 */
export const getTrendingEvents: Handler = async (_req, _params, { db }) => {
  const rows = await db.query(
    `${eventSelectWith(`${WHOS_GOING_OPEN} as going_open,
         (select count(*)::int from public.event_attendees a
           where a.event_id = e.id and not ${SUSPENDED_ATTENDEE}) as going_count`)}
     join private.trending_snapshot s on s.event_id = e.id
     where e.status = 'published' and o.status = 'approved' and e.ends_at > now()
       and not exists (select 1 from private.event_curation c where c.event_id = e.id and c.excluded)
     order by s.rank`,
  );
  const now = Date.now();
  const items: TrendingEvent[] =
    rows.length < TRENDING_MIN_ITEMS
      ? []
      : rows.map((row) => {
          const event = toEvent(row);
          const goingCount = row.going_count as number;
          if (row.going_open === true && goingCount >= TRENDING_GOING_THRESHOLD) {
            return { event: toPublicEventFromRow(row), label: "going", goingCount };
          }
          const firstApproval = event.moderationLog.find((entry) => entry.action === "approved");
          const justAnnounced = firstApproval !== undefined && now - Date.parse(firstApproval.at) <= JUST_ANNOUNCED_MS;
          return { event: toPublicEventFromRow(row), label: justAnnounced ? "just-announced" : "popular" };
        });
  const body: TrendingResponse = { items };
  return Response.json(body, { status: 200, headers: { "cache-control": TRENDING_CACHE_CONTROL } });
};

/**
 * GET /api/cron/trending — Vercel Cron (daily on the Hobby plan; every 15
 * minutes on Pro: vercel.json, docs/supabase-setup.md). Rebuilds the
 * snapshot. Returns counts only: how many events were eligible and how many
 * were ranked.
 */
export const runTrendingCron: Handler = async (req, _params, deps) => {
  requireCronSecret(req, deps.cronSecret());
  const [row] = await deps.db.query<{ eligible: number; ranked: number }>(
    `select eligible, ranked from private.refresh_trending()`,
  );
  return okPrivate({ eligible: row.eligible, ranked: row.ranked });
};

/** An event's curation and its newest log entries, or undefined for an unknown event. */
async function findCuration(db: Db, eventId: string): Promise<EventCuration | undefined> {
  const [row] = await db.query<{
    boost: string | number | null;
    excluded: boolean | null;
    updated_at: Date | string | null;
    log: { by: string; at: string; reason?: string; changes?: CurationLogEntry["changes"] }[];
  }>(
    `select c.boost, c.excluded, c.updated_at,
            coalesce((
              select json_agg(json_strip_nulls(json_build_object(
                       'by', coalesce(x.actor_id::text, 'system'), 'at', x.created_at,
                       'reason', x.reason, 'changes', x.details)) order by x.id desc)
                from (select l.id, l.actor_id, l.created_at, l.reason, l.details
                        from public.event_moderation_log l
                       where l.event_id = e.id and l.action = 'curated'
                       order by l.id desc limit $2) x
            ), '[]'::json) as log
       from public.events e
       left join private.event_curation c on c.event_id = e.id
      where e.id = $1`,
    [eventId, CURATION_LOG_LIMIT],
  );
  if (!row) return undefined;
  return {
    eventId,
    boost: row.boost === null ? 1 : Number(row.boost),
    excluded: row.excluded === true,
    updatedAt: row.updated_at === null ? null : new Date(row.updated_at).toISOString(),
    log: row.log.map((entry) => {
      const changes: CurationLogEntry["changes"] = {};
      if (entry.changes?.boost) {
        changes.boost = { old: Number(entry.changes.boost.old), new: Number(entry.changes.boost.new) };
      }
      if (entry.changes?.excluded) {
        changes.excluded = { old: entry.changes.excluded.old === true, new: entry.changes.excluded.new === true };
      }
      return {
        by: entry.by,
        at: new Date(entry.at).toISOString(),
        ...(entry.reason ? { reason: entry.reason } : {}),
        changes,
      };
    }),
  };
}

/** GET /api/admin/events/[eventId]/curation — admin. Any status; 404 for an unknown event. */
export const adminGetEventCuration: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  await requireAdmin(req, deps.verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const curation = await findCuration(deps.db, eventId);
  if (!curation) throw new HttpError(404, EVENT_NOT_FOUND);
  return okPrivate(curation);
};

/**
 * PUT /api/admin/events/[eventId]/curation — admin. Body {boost, excluded,
 * reason}, all required: boost a number from 0.5 to 2 (rounded to 2 decimal
 * places), excluded a boolean, reason 1–500 characters. Any status. Logged
 * as `curated` with the admin, the reason and the old and new value of each
 * changed field (private.set_event_curation); nothing changing is a 200 with
 * nothing logged. 400 fieldErrors; 404 unknown event.
 */
export const adminSetEventCuration: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const admin = await requireAdmin(req, deps.verifyAccessToken);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const body = await readJson(req);
  const errors: Record<string, string> = {};

  let boost = 1;
  if (typeof body.boost !== "number" || !Number.isFinite(body.boost)) {
    errors.boost = `Boost must be a number from ${MIN_TRENDING_BOOST} to ${MAX_TRENDING_BOOST}.`;
  } else {
    boost = Math.round(body.boost * 100) / 100;
    if (boost < MIN_TRENDING_BOOST || boost > MAX_TRENDING_BOOST) {
      errors.boost = `Boost must be a number from ${MIN_TRENDING_BOOST} to ${MAX_TRENDING_BOOST}.`;
    }
  }
  if (typeof body.excluded !== "boolean") errors.excluded = "Say whether the event is excluded from trending.";
  const reason = parseMessageText(body.reason, "reason", errors, {
    allowLinks: true,
    label: "Reasons",
    maxLength: MAX_CURATION_REASON_LENGTH,
  });
  if (Object.keys(errors).length > 0) fail(errors);

  const [row] = await deps.db.query<{ result: "updated" | "unchanged" | "not_found" }>(
    `select private.set_event_curation($1, $2, $3::numeric, $4, $5) as result`,
    [eventId, admin.userId, boost.toFixed(2), body.excluded, reason],
  );
  if (row.result === "not_found") throw new HttpError(404, EVENT_NOT_FOUND);
  const curation = await findCuration(deps.db, eventId);
  if (!curation) throw new HttpError(404, EVENT_NOT_FOUND);
  return okPrivate(curation);
};

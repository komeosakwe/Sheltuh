import {
  ORGANISER_EVENT_FILTERS,
  type DateRange,
  type ImageFocus,
  type OrganiserEventCounts,
  type OrganiserEventFilter,
  type OrganiserEventPerformance,
  type OrganiserEventStage,
  type OrganiserEventSummary,
  type OrganiserEventSummaryPage,
  type OrganiserOverview,
} from "@/lib/api/types";
import type { AustralianTimeZone, StateCode } from "@/lib/time-zones";
import { requireCaller } from "../auth";
import { addDays, melbourneDateOf, previousPeriod } from "../analytics-range";
import { NO_ORDERS, viewsComplete } from "../analytics-report";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { HttpError, okPrivate, tooManyRequests, windowSeconds } from "../http";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import type { Handler } from "../route";
import type { TicketingMode } from "../types";
import { ORGANISER_GROSS, organiserPeriod, viewsTrackedSince } from "./analytics";
import { requireApprovedOrganiser } from "./organiser-guard";

/**
 * The organiser dashboard's Overview and Events tab (docs/architecture.md,
 * "Organiser dashboard summaries"): read-only summaries of the caller's own
 * events. Only an approved organiser (403 otherwise, 401 signed out), and
 * only their own organiser's events: the routes take no organiser or event
 * id, so another organiser's events can't be named, let alone read. Admins
 * get nothing extra. Every response is `private, no-store`. Both reads share
 * one per-account rate limit (ORGANISER_SUMMARY_LIMIT), taken after the
 * organiser check and before any summary query.
 *
 * No buyer data: counts and money only. Followers are a count, never who
 * (docs/architecture.md, "Following organisers"). Sales use the analytics
 * definitions (`paid` orders, ORGANISER_GROSS, the Melbourne day an order
 * was placed); "sold / capacity" is the ticket types' own counters, as
 * EventRecord.ticketsSold.
 */

const TZ = "Australia/Melbourne";

/** Days in the Overview's "this week" (today and the 6 before it). */
export const OVERVIEW_WEEK_DAYS = 7;
/** Upcoming events on the Overview. */
export const OVERVIEW_UPCOMING = 2;
/** Events on the Overview's Performance panel. */
export const OVERVIEW_PERFORMANCE_LIMIT = 10;
/**
 * Live events the Overview returns rows for when choosing the banner, the
 * upcoming cards and the Performance panel (soonest first). It caps what is
 * returned, not the work: the database still derives every one of the
 * organiser's events' stages to sort and filter them (and the grouped counts
 * read them all), so a summary's cost grows with the organiser's event count.
 * An organiser with more live events than this still gets a correct Overview
 * for the soonest ones.
 */
const OVERVIEW_LIVE_SCAN = 100;

/**
 * Reads of the Overview and the Events tab together, per account (bucket
 * 'organiser_summary', private.take_rate_limit): room for a dashboard that
 * refreshes and pages, while bounding how often one account can make the
 * database walk all its events. Past it: 429 `rate_limited` with Retry-After.
 */
export const ORGANISER_SUMMARY_LIMIT = { bucket: "organiser_summary", hits: 60, window: "1 minute" } as const;

const RATE_LIMITED = "Too many requests for your dashboard. Wait a moment, then try again.";

const STAGES: readonly OrganiserEventStage[] = ["live", "sold_out", "ended", "in_review", "changes_needed", "unpublished", "draft"];

const FILTER_STAGES: Record<Exclude<OrganiserEventFilter, "all">, readonly OrganiserEventStage[]> = {
  live: ["live", "sold_out"],
  drafts: ["draft", "unpublished", "in_review", "changes_needed"],
  past: ["ended"],
};

/**
 * SQL: the organiser's events (`$1`) with their stage and ticket-type sums,
 * one row per event. The stage rules are OrganiserEventStage's: `unpublished`
 * is a draft with an `approved` entry in its log (it went live once, and the
 * only way from published back to draft is a takedown), as the dashboard's
 * `ticketingLocked` reads it. events_organiser_created_idx; the ticket types,
 * the log (event_moderation_log_event_idx) and the photo by primary key.
 */
export const EVENTS_WITH_STAGE = `
  select e.id, e.title, e.slug, e.starts_at, e.ends_at, e.time_zone, e.state, e.venue_name, e.suburb,
         e.ticketing_mode, e.external_free, e.rejection_reason,
         e.ends_at <= now() as ended,
         e.starts_at <= now() as started,
         t.types, t.paid_types, t.capacity, t.sold,
         '/api/events/' || e.id::text || '/image?v=' || floor(extract(epoch from i.updated_at))::bigint::text as image_url,
         case when i.focus_x is not null then json_build_object('x', i.focus_x, 'y', i.focus_y) end as image_focus,
         case
           when e.status = 'published' and e.ends_at <= now() then 'ended'
           when e.status = 'published' and t.types > 0 and t.sold_out_types = t.types then 'sold_out'
           when e.status = 'published' then 'live'
           when e.status = 'pending_review' then 'in_review'
           when e.status = 'rejected' then 'changes_needed'
           when exists (select 1 from public.event_moderation_log l where l.event_id = e.id and l.action = 'approved')
             then 'unpublished'
           else 'draft'
         end as stage
    from public.events e
    cross join lateral (
      select count(*)::int as types,
             (count(*) filter (where tt.price_cents > 0))::int as paid_types,
             (count(*) filter (where tt.quantity_sold >= tt.quantity_available))::int as sold_out_types,
             coalesce(sum(tt.quantity_available), 0)::bigint as capacity,
             coalesce(sum(tt.quantity_sold), 0)::bigint as sold
        from public.ticket_types tt
       where tt.event_id = e.id
    ) t
    left join public.event_images i on i.event_id = e.id
   where e.organiser_id = $1`;

/** Not ended soonest first, then ended most recent first (the analytics overview's order). */
const EVENT_ORDER = `order by ev.ended, case when not ev.ended then ev.starts_at end, ev.starts_at desc, ev.id`;

interface EventRow {
  id: string;
  title: string;
  slug: string;
  starts_at: string | Date;
  ends_at: string | Date;
  time_zone: AustralianTimeZone;
  state: StateCode;
  venue_name: string;
  suburb: string;
  ticketing_mode: TicketingMode;
  external_free: boolean;
  rejection_reason: string | null;
  ended: boolean;
  started: boolean;
  types: number;
  paid_types: number;
  capacity: number | string;
  sold: number | string;
  image_url: string | null;
  image_focus: ImageFocus | null;
  stage: OrganiserEventStage;
}

/** Sums come back as bigint (a string from postgres.js); all fit in a double exactly. */
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

const iso = (v: string | Date) => new Date(v).toISOString();

/**
 * Lifetime gross and booking fees per event (ORGANISER_GROSS and
 * application_fee_cents over every `paid` order, as analytics sums them), for
 * the given events of the organiser's: one grouped read
 * (orders_event_paid_created_idx), never one per event.
 */
export const LIFETIME_GROSS_SQL = `select o.event_id, sum(${ORGANISER_GROSS})::bigint as gross, sum(o.application_fee_cents)::bigint as fees
       from public.orders o
      where o.event_id = any($1::uuid[]) and o.organiser_id = $2 and o.status = 'paid'
      group by o.event_id`;

type LifetimeMoney = Map<string, { grossCents: number; netCents: number }>;

async function lifetimeGross(db: Db, organiserId: string, eventIds: string[]): Promise<LifetimeMoney> {
  if (eventIds.length === 0) return new Map();
  const rows = await db.query<{ event_id: string; gross: number | string; fees: number | string }>(LIFETIME_GROSS_SQL, [
    eventIds,
    organiserId,
  ]);
  return new Map(rows.map((r) => [r.event_id, { grossCents: n(r.gross), netCents: n(r.gross) - n(r.fees) }]));
}

function toSummary(row: EventRow, gross: LifetimeMoney): OrganiserEventSummary {
  const external = row.ticketing_mode === "external";
  const reasonShown = row.stage === "changes_needed" || row.stage === "unpublished";
  return {
    eventId: row.id,
    title: row.title,
    slug: row.slug,
    stage: row.stage,
    startsAt: iso(row.starts_at),
    endsAt: iso(row.ends_at),
    timeZone: row.time_zone,
    state: row.state,
    venueName: row.venue_name,
    suburb: row.suburb,
    ...(row.image_url ? { imageUrl: row.image_url } : {}),
    ...(row.image_url && row.image_focus ? { imageFocus: { x: n(row.image_focus.x), y: n(row.image_focus.y) } } : {}),
    ticketingMode: row.ticketing_mode,
    free: external ? row.external_free === true : n(row.types) > 0 && n(row.paid_types) === 0,
    ticketsSold: external ? 0 : n(row.sold),
    capacity: external ? 0 : n(row.capacity),
    grossCents: external ? 0 : (gross.get(row.id)?.grossCents ?? 0),
    netCents: external ? 0 : (gross.get(row.id)?.netCents ?? 0),
    ...(reasonShown && row.rejection_reason ? { rejectionReason: row.rejection_reason } : {}),
  };
}

/** At most `limit` of the organiser's events in `stages` (all of them when null), in EVENT_ORDER, from `offset`. */
async function eventRows(
  db: Db,
  organiserId: string,
  stages: readonly OrganiserEventStage[] | null,
  limit: number,
  offset: number,
): Promise<EventRow[]> {
  return db.query<EventRow>(
    `with ev as (${EVENTS_WITH_STAGE})
     select ev.* from ev
      where $2::text[] is null or ev.stage = any($2::text[])
      ${EVENT_ORDER}
      limit $3 offset $4`,
    [organiserId, stages, limit, offset],
  );
}

/** How many of the organiser's events are in each stage and filter (one grouped read). */
async function eventCounts(db: Db, organiserId: string): Promise<OrganiserEventCounts> {
  const rows = await db.query<{ stage: OrganiserEventStage; count: number }>(
    `with ev as (${EVENTS_WITH_STAGE})
     select ev.stage, count(*)::int as count from ev group by ev.stage`,
    [organiserId],
  );
  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<OrganiserEventStage, number>;
  for (const r of rows) byStage[r.stage] = n(r.count);
  const sum = (stages: readonly OrganiserEventStage[]) => stages.reduce((total, s) => total + byStage[s], 0);
  return {
    all: sum(STAGES),
    live: sum(FILTER_STAGES.live),
    drafts: sum(FILTER_STAGES.drafts),
    past: sum(FILTER_STAGES.past),
    byStage,
  };
}

/** The caller's approved organiser (401 / 403 first), then one hit of ORGANISER_SUMMARY_LIMIT. */
async function requireOrganiser(req: Request, deps: Deps) {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  const organiser = await requireApprovedOrganiser(deps.db, caller);
  const [{ allowed }] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, $2, $3, $4::interval) as allowed`,
    [caller.userId, ORGANISER_SUMMARY_LIMIT.bucket, ORGANISER_SUMMARY_LIMIT.hits, ORGANISER_SUMMARY_LIMIT.window],
  );
  if (!allowed) {
    throw tooManyRequests(RATE_LIMITED, windowSeconds(ORGANISER_SUMMARY_LIMIT.window), undefined, { code: "rate_limited" });
  }
  return organiser;
}

function parseFilter(raw: string | null): OrganiserEventFilter {
  if (raw === null || raw === "") return "all";
  const filter = ORGANISER_EVENT_FILTERS.find((f) => f === raw);
  if (!filter) {
    throw new HttpError(400, "Unknown filter.", { filter: `Use one of: ${ORGANISER_EVENT_FILTERS.join(", ")}.` });
  }
  return filter;
}

/** GET /api/organisers/me/events/summary?filter=all|live|drafts|past&cursor&limit — the Events tab. */
export const getMyEventsSummary: Handler = async (req, _params, deps) => {
  const organiser = await requireOrganiser(req, deps);
  const url = new URL(req.url);
  const filter = parseFilter(url.searchParams.get("filter"));
  const limit = parseLimit(url.searchParams.get("limit"));
  const offset = decodeCursor(url.searchParams.get("cursor"));

  const [rows, counts] = await Promise.all([
    eventRows(deps.db, organiser.organiserId, filter === "all" ? null : FILTER_STAGES[filter], limit + 1, offset),
    eventCounts(deps.db, organiser.organiserId),
  ]);
  const page = toPage(rows, offset, limit);
  const gross = await lifetimeGross(
    deps.db,
    organiser.organiserId,
    page.items.filter((r) => r.ticketing_mode !== "external").map((r) => r.id),
  );
  const body: OrganiserEventSummaryPage = {
    items: page.items.map((r) => toSummary(r, gross)),
    ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    counts,
  };
  return okPrivate(body);
};

/** The percentage change from `previous` to `current`, rounded; null when `previous` is 0. */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Members who started following the organiser (`$1`) within the Melbourne
 * dates `$2`..`$3` and still follow (an unfollow deletes the row): a count,
 * never who. organiser_follows_organiser_idx (organiser_id, created_at).
 */
export const NEW_FOLLOWERS_SQL = `select count(*)::int as count from public.organiser_follows f
      where f.organiser_id = $1
        and f.created_at >= ($2::date::timestamp at time zone '${TZ}')
        and f.created_at < (($3::date + 1)::timestamp at time zone '${TZ}')`;

async function newFollowers(db: Db, organiserId: string, range: DateRange): Promise<number> {
  const [row] = await db.query<{ count: number }>(NEW_FOLLOWERS_SQL, [organiserId, range.from, range.to]);
  return n(row?.count);
}

async function buildOverview(db: Db, organiserId: string): Promise<OrganiserOverview> {
  const today = melbourneDateOf();
  const range: DateRange = { from: addDays(today, -(OVERVIEW_WEEK_DAYS - 1)), to: today };
  const previousRange = previousPeriod(range);

  const [since, week, previousWeek, followers, live, counts] = await Promise.all([
    viewsTrackedSince(db),
    organiserPeriod(db, organiserId, range),
    organiserPeriod(db, organiserId, previousRange),
    newFollowers(db, organiserId, range),
    eventRows(db, organiserId, FILTER_STAGES.live, OVERVIEW_LIVE_SCAN, 0),
    eventCounts(db, organiserId),
  ]);

  const upcomingRows = live.slice(0, OVERVIEW_UPCOMING);
  const ticketed = live.filter((r) => r.ticketing_mode !== "external");
  const performanceRows = ticketed.slice(0, OVERVIEW_PERFORMANCE_LIMIT);
  const highlightRow = ticketed.find(
    (r) => r.stage === "live" && !r.started && n(r.capacity) > n(r.sold) && n(r.sold) > 0,
  );

  // Gross only for the events shown, and never for an external one (sold elsewhere).
  const shown = [...upcomingRows, ...performanceRows, ...(highlightRow ? [highlightRow] : [])];
  const gross = await lifetimeGross(
    db,
    organiserId,
    [...new Set(shown.filter((r) => r.ticketing_mode !== "external").map((r) => r.id))],
  );

  const performance: OrganiserEventPerformance[] = performanceRows.map((r) => {
    const summary = toSummary(r, gross);
    const ticketsThisWeek = (week.ordersByEvent.get(r.id) ?? NO_ORDERS).ticketsSold;
    const ticketsPreviousWeek = (previousWeek.ordersByEvent.get(r.id) ?? NO_ORDERS).ticketsSold;
    return {
      eventId: summary.eventId,
      title: summary.title,
      stage: r.stage as "live" | "sold_out",
      free: summary.free,
      ticketsSold: summary.ticketsSold,
      capacity: summary.capacity,
      grossCents: summary.grossCents,
      netCents: summary.netCents,
      ticketsThisWeek,
      ticketsPreviousWeek,
      deltaPct: deltaPct(ticketsThisWeek, ticketsPreviousWeek),
    };
  });

  return {
    thisWeek: {
      range,
      ticketsSold: week.ordersTotal.ticketsSold,
      views: week.viewsTotal,
      viewsUnreliable: week.capDays.size > 0,
      viewsComplete: viewsComplete(range, since),
      newFollowers: followers,
    },
    highlight: highlightRow ? toSummary(highlightRow, gross) : null,
    upcoming: upcomingRows.map((r) => toSummary(r, gross)),
    draftsCount: counts.drafts,
    performance,
  };
}

/** GET /api/organisers/me/overview — the Overview tab. */
export const getMyOverview: Handler = async (req, _params, deps) => {
  const organiser = await requireOrganiser(req, deps);
  return okPrivate(await buildOverview(deps.db, organiser.organiserId));
};

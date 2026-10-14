import type {
  AnalyticsDay,
  AnalyticsOverview,
  AnalyticsOverviewEvent,
  AnalyticsTotals,
  DateRange,
  EventAnalytics,
  EventStatus,
  SourceViews,
  TrackingLinkStats,
} from "@/lib/api/types";
import { VIEW_SOURCES } from "@/lib/api/types";
import type { FeePolicy } from "@/lib/types";
import { requireCaller } from "../auth";
import { DEFAULT_RANGE_DAYS, addDays, melbourneDateOf, parseAnalyticsQuery, previousPeriod } from "../analytics-range";
import {
  NO_ORDERS,
  conversionRate,
  dailySeries,
  eventAnalyticsCsv,
  money,
  overviewCsv,
  ticketTypeSales,
  totals,
  viewsComplete,
  type LineGroup,
  type OrderSums,
} from "../analytics-report";
import { csvResponse } from "../csv";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { okPrivate } from "../http";
import type { Handler } from "../route";
import type { EventRecord } from "../types";
import { requireOwnEvent } from "./event-queries";
import { requireApprovedOrganiser } from "./organiser-guard";

/**
 * Organiser analytics (docs/architecture.md, "Organiser analytics"). Only an
 * approved organiser, and only their own events: another organiser's event
 * is a 404, and admins get nothing extra here (no organiser of their own:
 * 403). Every response is `private, no-store`.
 *
 * Sales are `paid` orders only (free orders are A$0 paid orders), counted on
 * the Melbourne day the order was placed, with money from the orders' own
 * snapshots. Views are the aggregate daily counters (event_view_counts).
 */

const TZ = "Australia/Melbourne";

/** SQL: order `o` is paid and was placed within the Melbourne dates $from..$to (parameter names, e.g. "$2"). */
const paidInRange = (from: string, to: string) => `o.status = 'paid'
  and o.created_at >= (${from}::date::timestamp at time zone '${TZ}')
  and o.created_at < ((${to}::date + 1)::timestamp at time zone '${TZ}')`;

/** SQL: tickets in order `o`. */
const TICKETS = `(select coalesce(sum((li ->> 'quantity')::int), 0) from jsonb_array_elements(o.line_items) li)`;

/** SQL: the Melbourne day order `o` was placed. */
const ORDER_DAY = `(o.created_at at time zone '${TZ}')::date`;

/** Most events listed in the overview (the totals cover every event). */
export const OVERVIEW_EVENT_LIMIT = 500;

type Row = Record<string, unknown>;

/** Sums come back as bigint (a string from postgres.js); all fit in a double exactly. */
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

function orderSums(row: Row | undefined): OrderSums {
  if (!row) return NO_ORDERS;
  return { orders: n(row.orders), ticketsSold: n(row.tickets), grossCents: n(row.gross), feesCents: n(row.fees) };
}

/**
 * The first Melbourne day with view counts still available: when counting
 * started, or the 25-month retention horizon if that's later. Null if view
 * counting was never set up.
 */
async function viewsTrackedSince(db: Db): Promise<string | null> {
  const [row] = await db.query<{ since: string }>(
    `select greatest(s.views_tracked_since, ((now() at time zone '${TZ}')::date - interval '25 months')::date)::text as since
       from private.analytics_settings s`,
  );
  return row?.since ?? null;
}

async function requireOrganiserCaller(req: Request, deps: Deps) {
  const caller = await requireCaller(req, deps.verifyAccessToken);
  return requireApprovedOrganiser(deps.db, caller);
}

// ---------------------------------------------------------------------------
// One event
// ---------------------------------------------------------------------------

interface EventPeriod {
  viewsTotal: number;
  viewsByDay: Map<string, number>;
  viewsBySource: Map<string, number>;
  viewsByCode: Map<string, number>;
  ordersTotal: OrderSums;
  ordersByDay: Map<string, OrderSums>;
  ordersByCode: Map<string, OrderSums>;
}

async function eventPeriod(db: Db, eventId: string, range: DateRange): Promise<EventPeriod> {
  const [views, orders] = await Promise.all([
    db.query(
      `select v.day::text as day, v.source, v.link_code, sum(v.views)::bigint as views,
              grouping(v.day) as g_day, grouping(v.source) as g_source
         from public.event_view_counts v
        where v.event_id = $1 and v.day between $2::date and $3::date
        group by grouping sets ((v.day), (v.source), (v.link_code))`,
      [eventId, range.from, range.to],
    ),
    db.query(
      `select x.day::text as day, x.tracking_code, count(*)::int as orders, sum(x.tickets)::bigint as tickets,
              sum(x.total_cents)::bigint as gross, sum(x.application_fee_cents)::bigint as fees,
              grouping(x.day) as g_day, grouping(x.tracking_code) as g_code
         from (select ${ORDER_DAY} as day, o.tracking_code, o.total_cents, o.application_fee_cents, ${TICKETS} as tickets
                 from public.orders o
                where o.event_id = $1 and ${paidInRange("$2", "$3")}) x
        group by grouping sets ((), (x.day), (x.tracking_code))`,
      [eventId, range.from, range.to],
    ),
  ]);

  const period: EventPeriod = {
    viewsTotal: 0,
    viewsByDay: new Map(),
    viewsBySource: new Map(),
    viewsByCode: new Map(),
    ordersTotal: NO_ORDERS,
    ordersByDay: new Map(),
    ordersByCode: new Map(),
  };
  for (const r of views) {
    if (n(r.g_day) === 0) {
      period.viewsByDay.set(r.day as string, n(r.views));
      period.viewsTotal += n(r.views);
    } else if (n(r.g_source) === 0) period.viewsBySource.set(r.source as string, n(r.views));
    else if (r.link_code) period.viewsByCode.set(r.link_code as string, n(r.views));
  }
  for (const r of orders) {
    if (n(r.g_day) === 0) period.ordersByDay.set(r.day as string, orderSums(r));
    else if (n(r.g_code) === 0) {
      if (r.tracking_code) period.ordersByCode.set(r.tracking_code as string, orderSums(r));
    } else period.ordersTotal = orderSums(r);
  }
  return period;
}

async function ticketLineGroups(db: Db, eventId: string, range: DateRange): Promise<LineGroup[]> {
  const rows = await db.query(
    `select li ->> 'ticketTypeId' as id, max(li ->> 'ticketTypeName') as name, (li ->> 'unitPriceCents')::int as unit,
            li ->> 'feePolicy' as policy, sum((li ->> 'quantity')::int)::bigint as qty
       from public.orders o
      cross join lateral jsonb_array_elements(o.line_items) li
      where o.event_id = $1 and ${paidInRange("$2", "$3")}
      group by li ->> 'ticketTypeId', (li ->> 'unitPriceCents')::int, li ->> 'feePolicy'
      order by 1, 3, 4`,
    [eventId, range.from, range.to],
  );
  return rows.map((r) => ({
    ticketTypeId: r.id as string,
    ticketTypeName: r.name as string,
    unitPriceCents: n(r.unit),
    feePolicy: r.policy as FeePolicy,
    quantity: n(r.qty),
  }));
}

function trackingLinkStats(
  links: { id: string; code: string; label: string }[],
  views: Map<string, number>,
  orders: Map<string, OrderSums>,
): TrackingLinkStats[] {
  const stats = (code: string, link?: { id: string; label: string }): TrackingLinkStats => {
    const o = orders.get(code) ?? NO_ORDERS;
    const v = views.get(code) ?? 0;
    return {
      code,
      linkId: link?.id,
      label: link?.label,
      views: v,
      orders: o.orders,
      ticketsSold: o.ticketsSold,
      ...money(o.grossCents, o.feesCents),
      conversionRate: conversionRate(o.orders, v),
    };
  };
  const current = new Set(links.map((l) => l.code));
  const deleted = [...new Set([...views.keys(), ...orders.keys()])].filter((c) => !current.has(c)).sort();
  return [...links.map((l) => stats(l.code, l)), ...deleted.map((c) => stats(c))];
}

function periodTotals(p: EventPeriod, range: DateRange, since: string | null): AnalyticsTotals {
  return totals(p.ordersTotal, p.viewsTotal, viewsComplete(range, since));
}

async function buildEventAnalytics(db: Db, event: EventRecord, qs: URLSearchParams): Promise<EventAnalytics> {
  const today = melbourneDateOf();
  const { range, compare } = parseAnalyticsQuery(qs, { from: melbourneDateOf(event.createdAt), today });
  const previousRange = compare ? previousPeriod(range) : undefined;

  const [since, period, previous, groups, links] = await Promise.all([
    viewsTrackedSince(db),
    eventPeriod(db, event.eventId, range),
    previousRange ? eventPeriod(db, event.eventId, previousRange) : undefined,
    ticketLineGroups(db, event.eventId, range),
    db.query<{ id: string; code: string; label: string }>(
      `select l.id, l.code, l.label from public.event_tracking_links l where l.event_id = $1 order by l.created_at desc, l.id`,
      [event.eventId],
    ),
  ]);

  const bySource: SourceViews[] = VIEW_SOURCES.map((source) => ({ source, views: period.viewsBySource.get(source) ?? 0 }));

  return {
    event: {
      eventId: event.eventId,
      title: event.title,
      slug: event.slug,
      status: event.status,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      venueName: event.venueName,
      everPublished: event.moderationLog.some((entry) => entry.action === "approved"),
    },
    range,
    viewsTrackedSince: since,
    totals: periodTotals(period, range, since),
    byDay: dailySeries(range, period.viewsByDay, period.ordersByDay, since),
    bySource,
    byTicketType: ticketTypeSales(event.ticketTypes, groups, period.ordersTotal),
    trackingLinks: trackingLinkStats(links, period.viewsByCode, period.ordersByCode),
    ...(previous && previousRange
      ? {
          previous: {
            range: previousRange,
            totals: periodTotals(previous, previousRange, since),
            byDay: dailySeries(previousRange, previous.viewsByDay, previous.ordersByDay, since),
          },
        }
      : {}),
  };
}

async function eventAnalyticsFor(req: Request, eventId: string, deps: Deps) {
  const organiser = await requireOrganiserCaller(req, deps);
  const event = await requireOwnEvent(deps.db, organiser.organiserId, eventId);
  return buildEventAnalytics(deps.db, event, new URL(req.url).searchParams);
}

/** GET /api/organisers/me/events/[eventId]/analytics?from&to&compare=prevPeriod */
export const getEventAnalytics: Handler<{ eventId: string }> = async (req, { eventId }, deps) =>
  okPrivate(await eventAnalyticsFor(req, eventId, deps));

/** GET /api/organisers/me/events/[eventId]/analytics.csv?from&to&compare=prevPeriod */
export const getEventAnalyticsCsv: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const analytics = await eventAnalyticsFor(req, eventId, deps);
  return csvResponse(
    `sheltuh-${analytics.event.slug}_${analytics.range.from}_${analytics.range.to}.csv`,
    eventAnalyticsCsv(analytics),
  );
};

// ---------------------------------------------------------------------------
// Overview: every event of the organiser's
// ---------------------------------------------------------------------------

interface OrganiserPeriod {
  viewsTotal: number;
  viewsByEvent: Map<string, number>;
  viewsByDay: Map<string, number>;
  ordersTotal: OrderSums;
  ordersByEvent: Map<string, OrderSums>;
  ordersByDay: Map<string, OrderSums>;
}

async function organiserPeriod(db: Db, organiserId: string, range: DateRange): Promise<OrganiserPeriod> {
  const [views, orders] = await Promise.all([
    db.query(
      `select v.event_id, v.day::text as day, sum(v.views)::bigint as views,
              grouping(v.event_id) as g_event, grouping(v.day) as g_day
         from public.event_view_counts v
         join public.events e on e.id = v.event_id
        where e.organiser_id = $1 and v.day between $2::date and $3::date
        group by grouping sets ((), (v.event_id), (v.day))`,
      [organiserId, range.from, range.to],
    ),
    db.query(
      `select x.event_id, x.day::text as day, count(*)::int as orders, sum(x.tickets)::bigint as tickets,
              sum(x.total_cents)::bigint as gross, sum(x.application_fee_cents)::bigint as fees,
              grouping(x.event_id) as g_event, grouping(x.day) as g_day
         from (select o.event_id, ${ORDER_DAY} as day, o.total_cents, o.application_fee_cents, ${TICKETS} as tickets
                 from public.orders o
                where o.organiser_id = $1 and ${paidInRange("$2", "$3")}) x
        group by grouping sets ((), (x.event_id), (x.day))`,
      [organiserId, range.from, range.to],
    ),
  ]);

  const period: OrganiserPeriod = {
    viewsTotal: 0,
    viewsByEvent: new Map(),
    viewsByDay: new Map(),
    ordersTotal: NO_ORDERS,
    ordersByEvent: new Map(),
    ordersByDay: new Map(),
  };
  for (const r of views) {
    if (n(r.g_event) === 0) period.viewsByEvent.set(r.event_id as string, n(r.views));
    else if (n(r.g_day) === 0) period.viewsByDay.set(r.day as string, n(r.views));
    else period.viewsTotal = n(r.views);
  }
  for (const r of orders) {
    if (n(r.g_event) === 0) period.ordersByEvent.set(r.event_id as string, orderSums(r));
    else if (n(r.g_day) === 0) period.ordersByDay.set(r.day as string, orderSums(r));
    else period.ordersTotal = orderSums(r);
  }
  return period;
}

function overviewPeriod(p: OrganiserPeriod, range: DateRange, since: string | null) {
  return {
    range,
    totals: totals(p.ordersTotal, p.viewsTotal, viewsComplete(range, since)),
    byDay: dailySeries(range, p.viewsByDay, p.ordersByDay, since) as AnalyticsDay[],
  };
}

async function buildOverview(db: Db, organiserId: string, qs: URLSearchParams): Promise<AnalyticsOverview> {
  const today = melbourneDateOf();
  const { range, compare } = parseAnalyticsQuery(qs, { from: addDays(today, -(DEFAULT_RANGE_DAYS - 1)), today });
  const previousRange = compare ? previousPeriod(range) : undefined;

  const [since, period, previous, events] = await Promise.all([
    viewsTrackedSince(db),
    organiserPeriod(db, organiserId, range),
    previousRange ? organiserPeriod(db, organiserId, previousRange) : undefined,
    // Upcoming (not yet ended) soonest first, then past most recent first.
    db.query<{ id: string; title: string; slug: string; status: EventStatus; starts_at: string | Date }>(
      `select e.id, e.title, e.slug, e.status::text as status, e.starts_at
         from public.events e
        where e.organiser_id = $1
        order by e.ends_at < now(), case when e.ends_at >= now() then e.starts_at end, e.starts_at desc, e.id
        limit $2`,
      [organiserId, OVERVIEW_EVENT_LIMIT + 1],
    ),
  ]);

  const complete = viewsComplete(range, since);
  const previousComplete = previousRange ? viewsComplete(previousRange, since) : false;
  const rows: AnalyticsOverviewEvent[] = events.slice(0, OVERVIEW_EVENT_LIMIT).map((e) => ({
    eventId: e.id,
    title: e.title,
    slug: e.slug,
    status: e.status,
    startsAt: new Date(e.starts_at).toISOString(),
    totals: totals(period.ordersByEvent.get(e.id) ?? NO_ORDERS, period.viewsByEvent.get(e.id) ?? 0, complete),
    ...(previous
      ? { previous: totals(previous.ordersByEvent.get(e.id) ?? NO_ORDERS, previous.viewsByEvent.get(e.id) ?? 0, previousComplete) }
      : {}),
  }));

  const current = overviewPeriod(period, range, since);
  return {
    range,
    viewsTrackedSince: since,
    totals: current.totals,
    byDay: current.byDay,
    events: rows,
    eventsTruncated: events.length > OVERVIEW_EVENT_LIMIT,
    ...(previous && previousRange ? { previous: overviewPeriod(previous, previousRange, since) } : {}),
  };
}

async function overviewFor(req: Request, deps: Deps) {
  const organiser = await requireOrganiserCaller(req, deps);
  return buildOverview(deps.db, organiser.organiserId, new URL(req.url).searchParams);
}

/** GET /api/organisers/me/analytics/overview?from&to&compare=prevPeriod */
export const getAnalyticsOverview: Handler = async (req, _params, deps) => okPrivate(await overviewFor(req, deps));

/** GET /api/organisers/me/analytics/overview.csv?from&to&compare=prevPeriod */
export const getAnalyticsOverviewCsv: Handler = async (req, _params, deps) => {
  const overview = await overviewFor(req, deps);
  return csvResponse(`sheltuh-analytics_${overview.range.from}_${overview.range.to}.csv`, overviewCsv(overview));
};

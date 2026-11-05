import type { EventOrderRow, EventOrders } from "@/lib/api/types";
import type { AustralianTimeZone } from "@/lib/time-zones";
import { csvResponse } from "../csv";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { HttpError, okPrivate } from "../http";
import { orderReference } from "../order-reference";
import { eventOrdersCsv } from "../orders-report";
import { decodeCursor, isUuid, parseLimit, toPage } from "../pagination";
import type { OrderLineItem } from "../types";
import type { Handler } from "../route";
import { containsPattern, ORGANISER_SEARCH_FOLD, parseAdminSearch } from "./admin";
import { requireEventOperator } from "./organiser-guard";

/**
 * The organiser's Orders view (docs/architecture.md, "Organiser orders";
 * supabase/migrations/20261122000000_order_buyer_details.sql). Owner decision
 * (5 Nov 2026): the event's organiser sees the name and email of the people
 * who bought tickets, for 12 months after the event ends; the buyer is told at
 * checkout. Access is requireEventOperator: the approved owner of the event's
 * organiser, or an admin for a platform-managed organiser's event; anyone
 * else's event, or none, is a 404 and a suspended organiser a 403. Every
 * response is `private, no-store`. Nothing about a buyer is ever logged.
 *
 * Which orders: paid ones (free orders are A$0 paid orders), and refunded
 * ones that had tickets issued. Pending, failed and oversold orders and
 * unconfirmed guest bookings aren't listed.
 *
 * Which details: an order's name and email show only if it was made with a
 * name (details_notice_at: the buyer was shown the notice) and the event
 * ended less than DETAILS_VISIBLE_MONTHS ago; otherwise both are null. A
 * hidden detail is hidden from the search too (it can't be found by the text
 * it hides). The short reference (#A1B2C3D4) is the only order id: the full
 * `ord_` id is the buyer's credential and is never selected, returned or
 * exported.
 */

/** How long after the event ends the organiser can see buyers' names and emails (keep in step with lib/buyer-details.ts). */
export const DETAILS_VISIBLE_MONTHS = 12;

export const EVENT_ORDERS_LIMITS = {
  /** Page reads (and the start of an export), per account, bucket 'event_orders'. */
  reads: { hits: 240, window: "10 minutes" },
  /** CSV exports, per account, bucket 'order_exports' (private.record_order_export). */
  exports: { hits: 10, window: "1 hour" },
} as const;

/** The most orders one CSV carries; an event with more is a 409 (nothing is exported or logged). */
export const MAX_EXPORT_ROWS = 20_000;

/** The longest search text used. */
export const MAX_ORDER_SEARCH_LENGTH = 100;

const EVENT_NOT_FOUND = "Event not found.";
const RATE_LIMITED = "Too many requests for this list. Wait a moment, then try again.";
const EXPORT_RATE_LIMITED = "You've exported orders a lot in the last hour. Try again later.";
const EXPORT_TOO_LARGE = `This event has more than ${MAX_EXPORT_ROWS.toLocaleString("en-AU")} orders, too many for one file.`;

interface EventRow {
  title: string;
  slug: string;
  time_zone: AustralianTimeZone;
  ends_at: string | Date;
  visible_until: string | Date;
}

interface OrderDbRow {
  id: string;
  created_at: string | Date;
  status: "paid" | "refunded";
  buyer_name: string | null;
  buyer_email: string | null;
  line_items: OrderLineItem[];
  total_cents: number;
  support_cents: number;
  amount_refunded_cents: number;
}

const iso = (v: string | Date) => new Date(v).toISOString();

/** SQL: order `o` is one the organiser sees. */
const LISTED = `(o.status = 'paid' or (o.status = 'refunded' and exists (select 1 from public.tickets t where t.order_id = o.id)))`;

/** SQL: order `o`'s buyer details may be shown (needs the events row as `e`). In UTC, so the month arithmetic has no zone in it. */
const DETAILS_SHOWN = `(o.details_notice_at is not null
  and now() < ((e.ends_at at time zone 'UTC') + interval '${DETAILS_VISIBLE_MONTHS} months') at time zone 'UTC')`;

/** The operator's event: the organiser's own (or the platform-managed one's an admin acts for), else a 404. */
async function loadEvent(req: Request, deps: Deps, eventId: string) {
  const { caller, organiserId } = await requireEventOperator(req, deps, eventId);
  if (!isUuid(eventId)) throw new HttpError(404, EVENT_NOT_FOUND);
  const [event] = await deps.db.query<EventRow>(
    `select e.title, e.slug, e.time_zone, e.ends_at,
            ((e.ends_at at time zone 'UTC') + interval '${DETAILS_VISIBLE_MONTHS} months') at time zone 'UTC' as visible_until
       from public.events e where e.id = $1 and e.organiser_id = $2`,
    [eventId, organiserId],
  );
  if (!event) throw new HttpError(404, EVENT_NOT_FOUND);
  return { caller, organiserId, event };
}

async function takeReadLimit(db: Db, userId: string): Promise<void> {
  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'event_orders', $2, $3::interval) as allowed`,
    [userId, EVENT_ORDERS_LIMITS.reads.hits, EVENT_ORDERS_LIMITS.reads.window],
  );
  if (!allowed) throw new HttpError(429, RATE_LIMITED, undefined, { code: "rate_limited" });
}

/** The WHERE for the event's listed orders, and its parameters (from $1); a search adds the name/email/reference tests. */
function filter(eventId: string, search: string) {
  const params: unknown[] = [eventId];
  let where = `o.event_id = $1 and ${LISTED}`;
  if (search) {
    params.push(containsPattern(search));
    const text = `$${params.length}`;
    // The short reference is "#" + the first 8 characters of the id after "ord_", upper case (orderReference).
    const ref = search.replace(/^#+/, "").toUpperCase();
    let refTest = "false";
    if (ref) {
      params.push(containsPattern(ref));
      refTest = `upper(substr(o.id, 5, 8)) like $${params.length}`;
    }
    where += ` and (${refTest} or (${DETAILS_SHOWN}
      and (${ORGANISER_SEARCH_FOLD("o.buyer_name")} like ${text} or ${ORGANISER_SEARCH_FOLD("o.buyer_email")} like ${text})))`;
  }
  return { where, params };
}

function toRow(row: OrderDbRow): EventOrderRow {
  return {
    reference: orderReference(row.id),
    placedAt: iso(row.created_at),
    status: row.status,
    buyerName: row.buyer_name,
    buyerEmail: row.buyer_email,
    tickets: row.line_items.map((l) => ({ ticketTypeName: l.ticketTypeName, quantity: l.quantity })),
    paidCents: row.total_cents - row.support_cents,
    refundedCents: row.amount_refunded_cents,
  };
}

const COLUMNS = `o.id, o.created_at, o.status::text as status,
  case when ${DETAILS_SHOWN} then o.buyer_name end as buyer_name,
  case when ${DETAILS_SHOWN} then o.buyer_email end as buyer_email,
  o.line_items, o.total_cents, o.support_cents, o.amount_refunded_cents`;

/**
 * GET /api/organisers/me/events/[eventId]/orders?q=&cursor=&limit= — see
 * EventOrders (lib/api/types.ts). Newest first (created_at, then id). `q`
 * (at most MAX_ORDER_SEARCH_LENGTH characters, control characters removed)
 * matches the shown name or email, or the short reference, ignoring case and
 * accents; LIKE wildcards match literally. Served through orders_event_idx
 * (one event's orders); the search scans them (no index can serve a substring
 * of a folded expression). 240 reads per 10 minutes per account (429
 * `rate_limited`).
 */
export const getEventOrders: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { caller, event } = await loadEvent(req, deps, eventId);
  await takeReadLimit(deps.db, caller.userId);
  const qs = new URL(req.url).searchParams;
  const search = parseAdminSearch(qs.get("q"), MAX_ORDER_SEARCH_LENGTH);
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));

  const { where, params } = filter(eventId, search);
  const from = `from public.orders o join public.events e on e.id = o.event_id where ${where}`;
  const [{ total }] = await deps.db.query<{ total: number }>(`select count(*)::int as total ${from}`, params);
  const rows = await deps.db.query<OrderDbRow>(
    `select ${COLUMNS} ${from}
      order by o.created_at desc, o.id desc limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit + 1, offset],
  );
  const page = toPage(rows.map(toRow), offset, limit);
  return okPrivate({
    event: { title: event.title, slug: event.slug, timeZone: event.time_zone, endsAt: iso(event.ends_at) },
    detailsVisibleUntil: iso(event.visible_until),
    ...page,
    total,
  } satisfies EventOrders);
};

/**
 * GET /api/organisers/me/events/[eventId]/orders.csv — every listed order
 * (the search is not applied), newest first, with the details the page would
 * show. At most MAX_EXPORT_ROWS (409 otherwise, nothing logged). Each export
 * is logged first (private.record_order_export: who, which event, how many
 * rows; no buyer data) and limited to 10 an hour per account (429
 * `rate_limited`): the file is only sent once that has recorded it, so an
 * export that can't be logged isn't served.
 */
export const getEventOrdersCsv: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { caller, organiserId, event } = await loadEvent(req, deps, eventId);
  await takeReadLimit(deps.db, caller.userId);

  const { where, params } = filter(eventId, "");
  const rows = await deps.db.query<OrderDbRow>(
    `select ${COLUMNS} from public.orders o join public.events e on e.id = o.event_id where ${where}
      order by o.created_at desc, o.id desc limit $2`,
    [...params, MAX_EXPORT_ROWS + 1],
  );
  if (rows.length > MAX_EXPORT_ROWS) throw new HttpError(409, EXPORT_TOO_LARGE);

  const [{ result }] = await deps.db.query<{ result: string }>(
    `select private.record_order_export($1, $2, $3, $4, $5, $6::interval) as result`,
    [caller.userId, eventId, organiserId, rows.length, EVENT_ORDERS_LIMITS.exports.hits, EVENT_ORDERS_LIMITS.exports.window],
  );
  if (result === "rate_limited") throw new HttpError(429, EXPORT_RATE_LIMITED, undefined, { code: "rate_limited" });
  if (result !== "recorded") throw new Error(`Unexpected record_order_export result: ${result}`);

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(`sheltuh-orders-${event.slug}_${date}.csv`, eventOrdersCsv(rows.map(toRow), event.time_zone));
};

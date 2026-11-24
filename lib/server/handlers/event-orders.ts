import type { EventOrderHolder, EventOrderRow, EventOrders } from "@/lib/api/types";
import { DETAILS_VISIBLE_MONTHS } from "@/lib/buyer-details";
import type { AustralianTimeZone } from "@/lib/time-zones";
import { csvResponse } from "../csv";
import type { Db } from "../db";
import type { Deps } from "../deps";
import { HttpError, okPrivate, readJson, secondsUntilUtcMidnight, tooManyRequests, windowSeconds } from "../http";
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
 * ended less than DETAILS_VISIBLE_MONTHS (lib/buyer-details.ts) ago; otherwise both are null. A
 * hidden detail is hidden from the search too (it can't be found by the text
 * it hides). The short reference (#A1B2C3D4) is the only order id: the full
 * `ord_` id is the buyer's credential and is never selected, returned or
 * exported.
 *
 * Tickets sent on (docs/architecture.md, "Ticket transfers"): each order
 * lists its tickets that someone accepted, with their current holder
 * (`holders`, EventOrderHolder). A holder's name and email follow the buyer's
 * rules with the holder's own notice (holder_notice_at, stamped at accept),
 * the same 12 months, and support's withdrawal (holder_details_withdrawn_at);
 * otherwise both are null and the entry stays. Offers not yet accepted are
 * never shown. Never a ticket code.
 *
 * Every read of details is counted: a page adds its rows, and each holder it
 * shows, to the account's daily budget for the event
 * (private.order_detail_views, an aggregate per account, event and UTC day),
 * and an export logs its count of orders and shown holders
 * (private.order_detail_exports) against the same budget. Past
 * EVENT_ORDERS_LIMITS.dailyRows nothing more is served that day, and if the
 * count can't be recorded nothing is served at all.
 */

export const EVENT_ORDERS_LIMITS = {
  /** Page reads (and the start of an export), per account, bucket 'event_orders'. */
  reads: { hits: 240, window: "10 minutes" },
  /** CSV exports, per account, bucket 'order_exports' (private.record_order_export). */
  exports: { hits: 10, window: "1 hour" },
  /**
   * Rows of buyer details one account may be served for one event per UTC day,
   * page reads and exports together (private.take_order_detail_budget). Sized
   * so one full export (MAX_EXPORT_ROWS) fits with 5,000 rows of paging to
   * spare; more than that in a day isn't the organiser's own work. Reaching it
   * is a 429 `daily_limit`.
   */
  dailyRows: 25_000,
} as const;

/** The most orders one CSV carries; an event with more is a 409 (nothing is exported or logged). */
export const MAX_EXPORT_ROWS = 20_000;

/** The most bytes of a search request body (a search text is at most 100 characters). */
const MAX_SEARCH_BODY_BYTES = 2_048;

/** The longest search text used. */
export const MAX_ORDER_SEARCH_LENGTH = 100;

const EVENT_NOT_FOUND = "Event not found.";
const RATE_LIMITED = "Too many requests for this list. Wait a moment, then try again.";
const EXPORT_RATE_LIMITED = "You've exported orders a lot in the last hour. Try again later.";
const DAILY_LIMIT = "You've viewed a lot of buyer details for this event today. Try again tomorrow.";
const EXPORT_TOO_LARGE = `This event has more than ${MAX_EXPORT_ROWS.toLocaleString("en-AU")} orders, too many for one file.`;

interface EventRow {
  title: string;
  slug: string;
  time_zone: AustralianTimeZone;
  ends_at: string | Date;
  visible_until: string | Date;
}

/** One entry of OrderDbRow.holders (json: the time is a string). */
interface HolderJson {
  ticketNumber: number;
  ticketTypeName: string;
  holderName: string | null;
  holderEmail: string | null;
  transferredAt: string;
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
  holders: HolderJson[];
}

const iso = (v: string | Date) => new Date(v).toISOString();

/** SQL: order `o` is one the organiser sees. */
const LISTED = `(o.status = 'paid' or (o.status = 'refunded' and exists (select 1 from public.tickets t where t.order_id = o.id)))`;

/** SQL: order `o`'s buyer details may be shown (needs the events row as `e`). In UTC, so the month arithmetic has no zone in it. */
const DETAILS_SHOWN = `(o.details_notice_at is not null
  and now() < ((e.ends_at at time zone 'UTC') + interval '${DETAILS_VISIBLE_MONTHS} months') at time zone 'UTC')`;

/** SQL: transfer `x` is a current holding of one of order `o`'s tickets: accepted, and not replaced by a later re-send. */
const HOLDING = `(x.order_id = o.id and x.status = 'accepted' and x.superseded_at is null)`;

/**
 * SQL: holding `x`'s holder details may be shown (needs the events row as
 * `e`): the holder was shown the organiser notice when accepting, support
 * hasn't withdrawn them, and within the buyers' window (DETAILS_SHOWN's).
 */
const HOLDER_SHOWN = `(x.holder_notice_at is not null and x.holder_details_withdrawn_at is null
  and now() < ((e.ends_at at time zone 'UTC') + interval '${DETAILS_VISIBLE_MONTHS} months') at time zone 'UTC')`;

/**
 * SQL: order `o`'s holders (HolderJson), in ticket number order. The number
 * is the ticket's place among the order's tickets by type then code, as the
 * ticket page numbers them (records.ts NUMBERED_TICKETS). By
 * ticket_transfers_order_idx, then the tickets' primary key and
 * tickets_order_idx: only for orders with a holding.
 */
const HOLDERS = `coalesce((
  select json_agg(json_build_object(
           'ticketNumber', (select count(*) from public.tickets n
                             where n.order_id = o.id and (n.ticket_type_id, n.code) <= (t.ticket_type_id, t.code))::int,
           'ticketTypeName', t.ticket_type_name,
           'holderName', case when ${HOLDER_SHOWN} then x.holder_name end,
           'holderEmail', case when ${HOLDER_SHOWN} then x.accepted_email end,
           'transferredAt', x.decided_at)
         order by t.ticket_type_id, t.code)
    from private.ticket_transfers x
    join public.tickets t on t.code = x.ticket_code
   where ${HOLDING}
), '[]'::json)`;

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

/** The day's budget of buyer details is used up: it starts again at the next UTC midnight (private.order_detail_views' day). */
const dailyLimit = () => tooManyRequests(DAILY_LIMIT, secondsUntilUtcMidnight(), undefined, { code: "daily_limit" });

async function takeReadLimit(db: Db, userId: string): Promise<void> {
  const [{ allowed }] = await db.query<{ allowed: boolean }>(
    `select private.take_rate_limit($1, 'event_orders', $2, $3::interval) as allowed`,
    [userId, EVENT_ORDERS_LIMITS.reads.hits, EVENT_ORDERS_LIMITS.reads.window],
  );
  if (!allowed) throw tooManyRequests(RATE_LIMITED, windowSeconds(EVENT_ORDERS_LIMITS.reads.window), undefined, { code: "rate_limited" });
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
      and (${ORGANISER_SEARCH_FOLD("o.buyer_name")} like ${text} or ${ORGANISER_SEARCH_FOLD("o.buyer_email")} like ${text}))
      or exists (select 1 from private.ticket_transfers x where ${HOLDING} and ${HOLDER_SHOWN}
                   and (${ORGANISER_SEARCH_FOLD("x.holder_name")} like ${text} or ${ORGANISER_SEARCH_FOLD("x.accepted_email")} like ${text})))`;
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
    holders: row.holders.map(
      (h): EventOrderHolder => ({
        ticketNumber: h.ticketNumber,
        ticketTypeName: h.ticketTypeName,
        holderName: h.holderName,
        holderEmail: h.holderEmail,
        transferredAt: iso(h.transferredAt),
      }),
    ),
  };
}

/** How many of `rows`' holders are shown (each is a row of personal details for the budget). */
function shownHolders(rows: EventOrderRow[]): number {
  return rows.reduce((n, row) => n + (row.holders ?? []).filter((h) => h.holderName !== null).length, 0);
}

const COLUMNS = `o.id, o.created_at, o.status::text as status,
  case when ${DETAILS_SHOWN} then o.buyer_name end as buyer_name,
  case when ${DETAILS_SHOWN} then o.buyer_email end as buyer_email,
  o.line_items, o.total_cents, o.support_cents, o.amount_refunded_cents,
  ${HOLDERS} as holders`;

/** One page of the list, after the read limit and before the daily budget is charged for it. */
async function listPage(
  req: Request,
  deps: Deps,
  eventId: string,
  readRequest: () => Promise<{ q: unknown; cursor: string | null; limit: string | null }>,
) {
  const { caller, organiserId, event } = await loadEvent(req, deps, eventId);
  await takeReadLimit(deps.db, caller.userId);
  const { q, cursor, limit: rawLimit } = await readRequest();
  if (q !== undefined && q !== null && typeof q !== "string") {
    throw new HttpError(400, "Invalid search.", { q: "Search text must be a string." });
  }
  const search = parseAdminSearch(typeof q === "string" ? q : null, MAX_ORDER_SEARCH_LENGTH);
  const limit = parseLimit(rawLimit);
  const offset = decodeCursor(cursor);

  const { where, params } = filter(eventId, search);
  const from = `from public.orders o join public.events e on e.id = o.event_id where ${where}`;
  const [{ total }] = await deps.db.query<{ total: number }>(`select count(*)::int as total ${from}`, params);
  const rows = await deps.db.query<OrderDbRow>(
    `select ${COLUMNS} ${from}
      order by o.created_at desc, o.id desc limit $${params.length + 1} offset $${params.length + 2}`,
    [...params, limit + 1, offset],
  );
  const page = toPage(rows.map(toRow), offset, limit);

  // The rows, and the holders they show, are charged to the day's budget
  // before they leave (fail closed: a refusal, or an error here, serves nothing).
  // A search is charged at least one row, even with nothing on its page (one
  // past the end, or no match): its `total` says how many orders match the
  // text, so every search is counted and recorded.
  const charged = page.items.length + shownHolders(page.items);
  const [{ allowed }] = await deps.db.query<{ allowed: boolean }>(
    `select private.take_order_detail_budget($1, $2, $3, $4, $5) as allowed`,
    [caller.userId, eventId, organiserId, search ? Math.max(1, charged) : charged, EVENT_ORDERS_LIMITS.dailyRows],
  );
  if (!allowed) throw dailyLimit();

  return okPrivate({
    event: { title: event.title, slug: event.slug, timeZone: event.time_zone, endsAt: iso(event.ends_at) },
    detailsVisibleUntil: iso(event.visible_until),
    ...page,
    total,
  } satisfies EventOrders);
}

/**
 * GET /api/organisers/me/events/[eventId]/orders?cursor=&limit= — see
 * EventOrders (lib/api/types.ts). Newest first (created_at, then id). Plain
 * paging only: a search text is never put in a URL (it would reach request
 * logs and browser history), so `?q=` is a 400 and searching is the POST
 * below. Served through orders_event_idx (one event's orders). 240 reads per
 * 10 minutes per account (429 `rate_limited`), and the rows served count to
 * the account's daily budget for the event (429 `daily_limit`).
 */
export const getEventOrders: Handler<{ eventId: string }> = async (req, { eventId }, deps) =>
  listPage(req, deps, eventId, async () => {
    const qs = new URL(req.url).searchParams;
    if (qs.has("q")) {
      throw new HttpError(400, "Search with POST .../orders/search.", { q: "Search text can't go in the URL." });
    }
    return { q: null, cursor: qs.get("cursor"), limit: qs.get("limit") };
  });

/**
 * POST /api/organisers/me/events/[eventId]/orders/search with the JSON body
 * `{ q?, cursor?, limit? }`: the same page as the GET, filtered. `q` (at most
 * MAX_ORDER_SEARCH_LENGTH characters, control characters removed) matches the
 * shown name or email, or the short reference, ignoring case and accents;
 * LIKE wildcards match literally. The search scans the event's orders (no
 * index can serve a substring of a folded expression). Same limits as the GET.
 */
export const searchEventOrders: Handler<{ eventId: string }> = async (req, { eventId }, deps) =>
  listPage(req, deps, eventId, async () => {
    const { q, cursor, limit } = await readJson<{ q: unknown; cursor: unknown; limit: unknown }>(req, MAX_SEARCH_BODY_BYTES);
    if (cursor !== undefined && cursor !== null && typeof cursor !== "string") {
      throw new HttpError(400, "Invalid pagination cursor.");
    }
    if (limit !== undefined && limit !== null && typeof limit !== "number") {
      throw new HttpError(400, "Invalid limit.", { limit: "Limit must be a number." });
    }
    return { q, cursor: cursor ?? null, limit: limit === undefined || limit === null ? null : String(limit) };
  });

/**
 * `rows` with no more shown holders than `logged`: any beyond it (accepted
 * since the count) keep their entry without a name or email.
 */
function withinLogged(rows: EventOrderRow[], logged: number): EventOrderRow[] {
  let left = logged;
  return rows.map((row) => ({
    ...row,
    holders: (row.holders ?? []).map((h) => {
      if (h.holderName === null) return h;
      if (left > 0) {
        left -= 1;
        return h;
      }
      return { ...h, holderName: null, holderEmail: null };
    }),
  }));
}

/**
 * GET /api/organisers/me/events/[eventId]/orders.csv — every listed order
 * (the search is not applied), newest first, with the details the page would
 * show, holders included (one line per order). The order of work: count the
 * orders and their shown holders (cheap, no details read); over
 * MAX_EXPORT_ROWS orders is a 409 before anything else; then the export is
 * logged (private.record_order_export: who, which event, how many rows of
 * details, orders and shown holders together; no buyer data) against the
 * 10-an-hour limit per account (429 `rate_limited`) and the daily budget (429
 * `daily_limit`); only then are the rows read, at most as many orders, and
 * shown holders, as were logged (a holder accepted in between is in the file
 * without details). The file is only built once the log row exists, so an
 * export that can't be logged isn't served.
 */
export const getEventOrdersCsv: Handler<{ eventId: string }> = async (req, { eventId }, deps) => {
  const { caller, organiserId, event } = await loadEvent(req, deps, eventId);
  await takeReadLimit(deps.db, caller.userId);

  const { where, params } = filter(eventId, "");
  const from = `from public.orders o join public.events e on e.id = o.event_id where ${where}`;
  const [{ total, holders }] = await deps.db.query<{ total: number; holders: number }>(
    `select count(*)::int as total,
            (select count(*)::int from private.ticket_transfers x
               join public.orders o on o.id = x.order_id join public.events e on e.id = o.event_id
              where ${where} and ${HOLDING} and ${HOLDER_SHOWN}) as holders
       ${from}`,
    params,
  );
  if (total > MAX_EXPORT_ROWS) throw new HttpError(409, EXPORT_TOO_LARGE);

  const [{ result }] = await deps.db.query<{ result: string }>(
    `select private.record_order_export($1, $2, $3, $4, $5, $6::interval, $7) as result`,
    [
      caller.userId,
      eventId,
      organiserId,
      total + holders,
      EVENT_ORDERS_LIMITS.exports.hits,
      EVENT_ORDERS_LIMITS.exports.window,
      EVENT_ORDERS_LIMITS.dailyRows,
    ],
  );
  if (result === "rate_limited") {
    throw tooManyRequests(EXPORT_RATE_LIMITED, windowSeconds(EVENT_ORDERS_LIMITS.exports.window), undefined, { code: "rate_limited" });
  }
  if (result === "budget_exceeded") throw dailyLimit();
  if (result !== "recorded") throw new Error(`Unexpected record_order_export result: ${result}`);

  // Never more than the logged count, even if orders arrived since the count.
  const rows = await deps.db.query<OrderDbRow>(
    `select ${COLUMNS} ${from} order by o.created_at desc, o.id desc limit $${params.length + 1}`,
    [...params, total],
  );

  const date = new Date().toISOString().slice(0, 10);
  return csvResponse(`sheltuh-orders-${event.slug}_${date}.csv`, eventOrdersCsv(withinLogged(rows.map(toRow), holders), event.time_zone));
};

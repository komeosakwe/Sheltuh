import { requireVerifiedCaller } from "../auth";
import { okPrivate } from "../http";
import { decodeCursor, parseLimit, toPage } from "../pagination";
import { eventPlaceOf, refundReason } from "../records";
import type { Handler } from "../route";
import { transferReference } from "../transfer-reference";
import type { MyTicketItem, MyTicketSection, MyTicketsPage } from "../types";

/**
 * My tickets (GET /api/me/tickets; docs/architecture.md, "API" and "Ticket
 * transfers"). Its own file, so the source scan in
 * tests/server/ticket-transfer-invariants.test.ts proves it never reads a
 * recipient's code.
 *
 * Whose cards: only the token's verified email and user id pick them;
 * nothing in the request does (only `cursor` and `limit` are read).
 * - Orders: `paid`, `refunded` and `oversold_refund_required` orders whose
 *   buyer_email equals the verified email ignoring case (the exact address,
 *   as private.member_held_tickets and orderControl match: never +tag or
 *   Gmail-dot folding, never buyer_email_key). Pending and failed orders
 *   aren't tickets. Paid ones by orders_paid_email_event_idx, the refunded
 *   and oversold ones by orders_refunded_email_idx
 *   (20261205000000_member_refunded_orders_index.sql).
 * - Received: transfers this account accepted (ticket_transfers_holder_idx),
 *   superseded ones included (they're void).
 *
 * Which list: `upcoming` while the caller holds a ticket of the card
 * (member_held_tickets, the one definition) and its event hasn't ended
 * (in progress and unlisted events included); `past` otherwise. Upcoming by
 * start, soonest first; past by the event's end, newest first (a refunded or
 * sent-away card of an event still to come included, so it sorts first);
 * ties by kind, then id. Every card is numbered in that order, the page cut,
 * and only the page's cards joined to their details.
 *
 * Event details: a published event's public details are on every card,
 * valid or not (the detail pages show them only while the tickets are
 * valid): a past card still says which night it was.
 *
 * Never in the answer: a ticket code or issued code (the held tickets'
 * codes are a join key inside the statement only), the buyer's name or
 * email, Stripe ids or the fee split. A received card reads nothing from the
 * sender's order (whether it's still valid comes from member_held_tickets).
 */

type Row = {
  upcoming: number;
  past: number;
  kind: "order" | "received" | null;
  section: 0 | 1;
  order_id: string | null;
  transfer_id: string | null;
  order_status: "paid" | "refunded" | "oversold_refund_required" | null;
  total_cents: number | null;
  amount_refunded_cents: number | null;
  ticket_count: number | null;
  held_count: number | null;
  pending_count: number | null;
  checked_in_count: number | null;
  order_type_name: string | null;
  sender_name: string | null;
  holder_name: string | null;
  accepted_at: Date | string | null;
  received_type_name: string | null;
  received_valid: boolean | null;
  received_checked_in_at: Date | string | null;
  event_title: string | null;
  event_status: string | null;
  event_slug: string | null;
  event_starts_at: Date | string | null;
  event_ends_at: Date | string | null;
  event_venue_name: string | null;
  event_suburb: string | null;
  event_state: string | null;
  event_time_zone: string | null;
  image_url: string | null;
  image_focus: { x: number; y: number } | null;
};

/**
 * $1 the verified email, $2 the user id, $3 the rows to fetch (the page
 * size plus one), $4 the offset. One read-only statement.
 */
const MY_TICKETS_SQL = `
  with held as materialized (
    -- The caller's tickets (member_held_tickets). No code leaves this CTE: what the cards count only.
    select h.order_id, h.transfer_id, t.checked_in_at,
           h.transfer_id is null and exists (
             select 1 from private.ticket_transfers p
              where p.ticket_code = h.ticket_code and p.status = 'pending' and p.sender_kind = 'buyer'
                and p.expires_at > now()) as pending
      from private.member_held_tickets($2::uuid, $1::text) h
      join public.tickets t on t.code = h.ticket_code
  ),
  cards as materialized (
    select c.kind, c.order_id, c.transfer_id, c.sort_id,
           case when e.ends_at > now()
                 and case when c.kind = 'order'
                          then exists (select 1 from held h where h.order_id = c.order_id and h.transfer_id is null)
                          else exists (select 1 from held h where h.transfer_id = c.transfer_id) end
                then 0 else 1 end as section,
           e.starts_at, e.ends_at
      from (
        select 'order'::text as kind, o.id as order_id, null::uuid as transfer_id, o.id as sort_id, o.event_id
          from public.orders o
         where lower(o.buyer_email) = lower($1::text) and o.status = 'paid'
        union all
        select 'order', o.id, null, o.id, o.event_id
          from public.orders o
         where lower(o.buyer_email) = lower($1::text) and o.status in ('refunded', 'oversold_refund_required')
        union all
        select 'received', null, x.id, x.id::text, x.event_id
          from private.ticket_transfers x
         where x.accepted_user_id = $2::uuid and x.status = 'accepted'
      ) c
      -- orders.event_id and ticket_transfers.event_id are not null (orders' restricts the event's delete).
      join public.events e on e.id = c.event_id
  ),
  counts as (
    select (count(*) filter (where section = 0))::int as upcoming,
           (count(*) filter (where section = 1))::int as past
      from cards
  ),
  page as materialized (
    select c.kind, c.order_id, c.transfer_id, c.section,
           row_number() over (
             order by c.section, case when c.section = 0 then c.starts_at end,
                      case when c.section = 1 then c.ends_at end desc, c.kind, c.sort_id) as rn
      from cards c
     order by rn
     limit $3::bigint offset $4::bigint
  )
  select n.upcoming, n.past, p.kind, p.section, p.order_id, p.transfer_id::text as transfer_id,
         o.status::text as order_status, o.total_cents, o.amount_refunded_cents,
         (select count(*)::int from public.tickets t where t.order_id = o.id) as ticket_count,
         (select count(*)::int from held h where h.order_id = o.id and h.transfer_id is null) as held_count,
         (select count(*)::int from held h where h.order_id = o.id and h.transfer_id is null and h.pending) as pending_count,
         (select count(*)::int from held h
           where h.order_id = o.id and h.transfer_id is null and h.checked_in_at is not null) as checked_in_count,
         (select case when count(distinct t.ticket_type_name) = 1 then min(t.ticket_type_name) end
            from public.tickets t where t.order_id = o.id) as order_type_name,
         x.sender_name, x.holder_name, x.decided_at as accepted_at, xt.ticket_type_name as received_type_name,
         exists (select 1 from held h where h.transfer_id = x.id) as received_valid,
         xt.checked_in_at as received_checked_in_at,
         case when p.kind = 'order' then o.event_title else e.title end as event_title,
         e.status::text as event_status, e.slug as event_slug,
         e.starts_at as event_starts_at, e.ends_at as event_ends_at,
         e.venue_name as event_venue_name, e.suburb as event_suburb,
         e.state as event_state, e.time_zone as event_time_zone,
         (select '/api/events/' || e.id::text || '/image?v=' || floor(extract(epoch from i.updated_at))::bigint::text
            from public.event_images i where i.event_id = e.id) as image_url,
         (select json_build_object('x', i.focus_x, 'y', i.focus_y)
            from public.event_images i where i.event_id = e.id and i.focus_x is not null) as image_focus
    from counts n
    left join page p on true
    left join public.orders o on p.kind = 'order' and o.id = p.order_id
    left join private.ticket_transfers x on p.kind = 'received' and x.id = p.transfer_id
    left join public.tickets xt on xt.code = x.ticket_code
    -- Left joins only for the counts' row when the page is empty.
    left join public.events e on e.id = coalesce(o.event_id, x.event_id)
   order by p.rn`;

const iso = (value: Date | string) => new Date(value).toISOString();

/** The event's fields of a card: the title and whether it's listed always; its public details only while it's published. */
function eventFields(row: Row) {
  const listed = row.event_status === "published";
  return {
    section: (row.section === 0 ? "upcoming" : "past") as MyTicketSection,
    eventTitle: row.event_title as string,
    eventListed: listed,
    ...(listed && row.event_slug ? { eventSlug: row.event_slug } : {}),
    ...(listed && row.event_starts_at ? { eventStartsAt: iso(row.event_starts_at), ...eventPlaceOf(row) } : {}),
    ...(listed && row.event_ends_at ? { eventEndsAt: iso(row.event_ends_at) } : {}),
    ...(listed && row.event_venue_name ? { venueName: row.event_venue_name } : {}),
    ...(listed && row.event_suburb ? { suburb: row.event_suburb } : {}),
    ...(listed && row.image_url ? { imageUrl: row.image_url } : {}),
    ...(listed && row.image_focus ? { imageFocus: { x: row.image_focus.x, y: row.image_focus.y } } : {}),
  };
}

function toItem(row: Row): MyTicketItem {
  if (row.kind === "order") {
    const status = row.order_status as "paid" | "refunded" | "oversold_refund_required";
    const ticketCount = row.ticket_count ?? 0;
    const reason = refundReason(status, ticketCount > 0, Number(row.amount_refunded_cents ?? 0));
    return {
      kind: "order",
      orderId: row.order_id as string,
      status,
      ...(reason ? { refundReason: reason } : {}),
      totalCents: row.total_cents ?? 0,
      ticketCount,
      heldCount: row.held_count ?? 0,
      pendingCount: row.pending_count ?? 0,
      checkedInCount: row.checked_in_count ?? 0,
      ...(row.order_type_name ? { ticketTypeName: row.order_type_name } : {}),
      ...eventFields(row),
    };
  }
  const valid = row.received_valid === true;
  return {
    kind: "received",
    transferId: row.transfer_id as string,
    reference: transferReference(row.transfer_id as string),
    status: valid ? "valid" : "void",
    fromName: row.sender_name as string,
    holderName: row.holder_name as string,
    acceptedAt: iso(row.accepted_at as Date | string),
    ticketTypeName: row.received_type_name as string,
    ...(valid && row.received_checked_in_at ? { checkedInAt: iso(row.received_checked_in_at) } : {}),
    ...eventFields(row),
  };
}

/**
 * GET /api/me/tickets?cursor&limit — the verified caller's My tickets
 * (MyTicketsPage), `private, no-store`: 401 signed out, 403 email not
 * verified, 400 a bad cursor. 20 a page by default, 50 at most.
 */
export const listMyTickets: Handler = async (req, _params, { db, verifyAccessToken }) => {
  const caller = await requireVerifiedCaller(req, verifyAccessToken);
  const qs = new URL(req.url).searchParams;
  const limit = parseLimit(qs.get("limit"));
  const offset = decodeCursor(qs.get("cursor"));
  const rows = await db.query<Row>(MY_TICKETS_SQL, [caller.email, caller.userId, limit + 1, offset]);
  const counts = { upcoming: rows[0]?.upcoming ?? 0, past: rows[0]?.past ?? 0 };
  const cards = rows.filter((row) => row.kind !== null);
  const page: MyTicketsPage = { ...toPage(cards.map(toItem), offset, limit), counts };
  return okPrivate(page);
};

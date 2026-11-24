import { ticketTransfersEnabled } from "@/lib/ticket-transfers-flag";
import { TICKET_TRANSFER_RULES } from "@/lib/ticket-transfer-rules";
import type { Deps } from "./deps";
import { windowSeconds } from "./http";
import { hasOrderAccess } from "./order-access";
import type { OrderTransfers } from "@/lib/api/types";
import type { CustomerOrder } from "./types";
import { optionalCaller } from "./handlers/free-orders";

/**
 * Shared server helpers for ticket transfers ("Send ticket to a friend";
 * docs/architecture.md, "Ticket transfers"). The database functions are in
 * supabase/migrations/20261203000000_ticket_transfers.sql, the routes in
 * ./handlers/ticket-transfers.ts.
 */

export { hashTransferToken, newTransferToken, TRANSFER_TOKEN_PATTERN } from "./transfer-token";
export { transferReference } from "./transfer-reference";

/** How a request controls an order, for sending or cancelling its tickets (owner decision D1). */
export type OrderControl =
  | { kind: "paying_browser" }
  /** `email`: the account's verified email, trimmed and lower-cased (the database re-checks it against the order's under its lock). */
  | { kind: "account"; userId: string; email: string };

/** What deciding control of an order needs to know about it (orderFacts). */
export interface OrderFacts {
  buyerEmail: string | null;
  status: string;
  /** Its email has been changed at all (by the buyer or support): the masked address is then shown to no one but the paying browser. */
  emailChanged: boolean;
  /** Support has changed its email: the paying browser's token no longer controls it. */
  changedBySupport: boolean;
}

/** The order's buyer email, status and email-change history (order_email_changes_order_idx), or null for an unknown order. */
export async function orderFacts(deps: Deps, orderId: string): Promise<OrderFacts | null> {
  const [row] = await deps.db.query<{ buyer_email: string | null; status: string; changed: boolean; by_support: boolean }>(
    `select o.buyer_email, o.status::text as status,
            exists (select 1 from private.order_email_changes c where c.order_id = o.id) as changed,
            exists (select 1 from private.order_email_changes c where c.order_id = o.id and c.changed_by = 'admin') as by_support
       from public.orders o where o.id = $1`,
    [orderId],
  );
  if (!row) return null;
  return { buyerEmail: row.buyer_email, status: row.status, emailChanged: row.changed, changedBySupport: row.by_support };
}

/**
 * Whether `req` controls order `orderId`: the paying browser (the order's
 * access token in `x-order-access`, lib/server/order-access.ts) unless
 * support has changed the order's email (the token may be on a device the
 * old address's holder still uses: as withOrderEmail, ./order-email-view.ts,
 * stops showing it the address), or a signed-in account with a verified
 * email equal to the order's buyer_email, ignoring case (the exact address,
 * as Who's Going matches; never +tag or Gmail-dot folding). The order's link
 * alone can view, never send. Null otherwise. `facts`: the order's, when the
 * caller has read them already. The database re-checks the support change
 * under the order's lock (create_ticket_transfer, cancel_ticket_transfer).
 */
export async function orderControl(
  req: Request,
  deps: Deps,
  orderId: string,
  facts?: OrderFacts | null,
): Promise<OrderControl | null> {
  const known = facts === undefined ? await orderFacts(deps, orderId) : facts;
  if (!known) return null;
  if (!known.changedBySupport && hasOrderAccess(req, deps, orderId)) return { kind: "paying_browser" };
  const caller = await optionalCaller(req, deps);
  if (!caller || caller.emailVerified !== true || !caller.email) return null;
  const email = known.buyerEmail;
  const callerEmail = caller.email.trim().toLowerCase();
  if (!email || callerEmail !== email.trim().toLowerCase()) return null;
  return { kind: "account", userId: caller.userId, email: callerEmail };
}

/** When sending closes for an event starting at `startsAt`: its start less the cut-off. */
export function transfersCloseAt(startsAt: string): Date {
  return new Date(new Date(startsAt).getTime() - windowSeconds(TICKET_TRANSFER_RULES.cutoffBeforeStart) * 1000);
}

/**
 * `order` (the ticket page's view of a paid order) as this request may see
 * it and with what it may do with its tickets:
 * - who an offer went to (`toName`, `toMaskedEmail`, its `transferId`) and
 *   who holds a sent ticket (`holderName`, `acceptedByMaskedEmail`) only for
 *   a request that controls the order (orderControl); anyone else with the
 *   order's link sees only that a ticket is on offer or was sent;
 * - each offer in progress gets `canCancel`, true only with control and
 *   while senders may cancel; cancelling works whatever the flag says, so a
 *   sender can always take an offer back;
 * - while sending is on (NEXT_PUBLIC_TICKET_TRANSFERS), `transfers` (whether
 *   this request may send now, and why not) and each ticket's `canSend` (not
 *   already offered, not checked in). The database re-checks everything when
 *   a ticket is sent.
 * With the flag off and no offer in progress or sent ticket the order is
 * unchanged (and no account lookup is made). `control`: the request's, when
 * the caller has worked it out already (a send or cancel).
 */
export async function withTicketTransfers(
  req: Request,
  deps: Deps,
  orderId: string,
  order: CustomerOrder,
  control?: OrderControl | null,
): Promise<CustomerOrder> {
  if (order.status !== "paid") return order;
  const enabled = ticketTransfersEnabled();
  const offered = order.tickets.some((t) => t.transfer);
  const sent = (order.transferredTickets?.length ?? 0) > 0;
  if (!enabled && !offered && !sent) return order;
  const controlled = control === undefined ? await orderControl(req, deps, orderId) : control;
  const canCancel = controlled !== null && TICKET_TRANSFER_RULES.senderMayCancel;
  const tickets = order.tickets.map((t) => {
    if (!t.transfer) return t;
    if (controlled) return { ...t, transfer: { ...t.transfer, canCancel } };
    return { ...t, transfer: { status: t.transfer.status, expiresAt: t.transfer.expiresAt, canCancel: false } };
  });
  const transferredTickets = controlled
    ? order.transferredTickets
    : order.transferredTickets?.map(({ ticketNumber, ticketTypeName, seat, group, acceptedAt }) => ({
        ticketNumber,
        ticketTypeName,
        ...(seat ? { seat } : {}),
        ...(group ? { group } : {}),
        acceptedAt,
      }));
  const shown: CustomerOrder = { ...order, tickets, ...(transferredTickets ? { transferredTickets } : {}) };
  if (!enabled) return shown;

  const closesAt = order.eventStartsAt ? transfersCloseAt(order.eventStartsAt) : undefined;
  let reason: OrderTransfers["reason"];
  if (order.eventListed !== true || !closesAt) reason = "unlisted";
  else if (Date.now() >= closesAt.getTime()) reason = "closed";
  else if (!controlled) reason = "sign_in";
  const canSend = reason === undefined;
  const transfers: OrderTransfers = {
    canSend,
    ...(reason ? { reason } : {}),
    ...(closesAt ? { closesAt: closesAt.toISOString() } : {}),
  };
  return {
    ...shown,
    tickets: tickets.map((t) => ({ ...t, canSend: canSend && !t.transfer && !t.checkedInAt })),
    transfers,
  };
}

/**
 * Sends the transfer emails queued by a send, accept or decline straight
 * after the response (sendTicketTransferEmailsSoon, ./email-outbox.ts); the
 * email cron sends anything left.
 */
export { sendTicketTransferEmailsSoon as ticketTransferJobsSoon } from "./email-outbox";

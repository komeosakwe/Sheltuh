import { createHash, randomBytes } from "node:crypto";
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

/** An offer link's token: 32 random bytes, base64url (43 characters). */
export const TRANSFER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new offer link token (minted per email attempt by the outbox worker, PR-2). Never stored or logged: only its hash. */
export function newTransferToken(): string {
  return randomBytes(32).toString("base64url");
}

/** What private.ticket_transfer_tokens stores for `token`: SHA-256, hex. */
export function hashTransferToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A transfer's short reference ("#1A2B3C4D"), shown to the recipient and support: never the order's (orderReference). */
export function transferReference(transferId: string): string {
  return `#${transferId.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

/** How a request controls an order, for sending or cancelling its tickets (owner decision D1). */
export type OrderControl = { kind: "paying_browser" } | { kind: "account"; userId: string };

/**
 * Whether `req` controls order `orderId`: the paying browser (the order's
 * access token in `x-order-access`, lib/server/order-access.ts), or a
 * signed-in account with a verified email equal to the order's buyer_email,
 * ignoring case (the exact address, as Who's Going matches; never +tag or
 * Gmail-dot folding). The order's link alone can view, never send. Null
 * otherwise. `buyerEmail`: the order's, when the caller has read it already.
 */
export async function orderControl(
  req: Request,
  deps: Deps,
  orderId: string,
  buyerEmail?: string | null,
): Promise<OrderControl | null> {
  if (hasOrderAccess(req, deps, orderId)) return { kind: "paying_browser" };
  const caller = await optionalCaller(req, deps);
  if (!caller || caller.emailVerified !== true || !caller.email) return null;
  let email = buyerEmail;
  if (email === undefined) {
    const [row] = await deps.db.query<{ buyer_email: string | null }>(`select buyer_email from public.orders where id = $1`, [
      orderId,
    ]);
    email = row?.buyer_email ?? null;
  }
  if (!email || caller.email.trim().toLowerCase() !== email.trim().toLowerCase()) return null;
  return { kind: "account", userId: caller.userId };
}

/** When sending closes for an event starting at `startsAt`: its start less the cut-off. */
export function transfersCloseAt(startsAt: string): Date {
  return new Date(new Date(startsAt).getTime() - windowSeconds(TICKET_TRANSFER_RULES.cutoffBeforeStart) * 1000);
}

/**
 * `order` (the ticket page's view of a paid order) with what this request
 * may do with its tickets:
 * - each offer in progress gets `canCancel`, true only when the request
 *   controls the order (orderControl) and senders may cancel; cancelling
 *   works whatever the flag says, so a sender can always take an offer back;
 * - while sending is on (NEXT_PUBLIC_TICKET_TRANSFERS), `transfers` (whether
 *   this request may send now, and why not) and each ticket's `canSend` (not
 *   already offered, not checked in). The database re-checks everything when
 *   a ticket is sent.
 * With the flag off and no offer in progress the order is unchanged (and no
 * account lookup is made). Offers in progress and sent tickets show either way.
 */
export async function withTicketTransfers(
  req: Request,
  deps: Deps,
  orderId: string,
  order: CustomerOrder,
): Promise<CustomerOrder> {
  if (order.status !== "paid") return order;
  const enabled = ticketTransfersEnabled();
  const offered = order.tickets.some((t) => t.transfer);
  if (!enabled && !offered) return order;
  const control = await orderControl(req, deps, orderId);
  const canCancel = control !== null && TICKET_TRANSFER_RULES.senderMayCancel;
  const tickets = order.tickets.map((t) => (t.transfer ? { ...t, transfer: { ...t.transfer, canCancel } } : t));
  if (!enabled) return { ...order, tickets };

  const closesAt = order.eventStartsAt ? transfersCloseAt(order.eventStartsAt) : undefined;
  let reason: OrderTransfers["reason"];
  if (order.eventListed !== true || !closesAt) reason = "unlisted";
  else if (Date.now() >= closesAt.getTime()) reason = "closed";
  else if (!control) reason = "sign_in";
  const canSend = reason === undefined;
  const transfers: OrderTransfers = {
    canSend,
    ...(reason ? { reason } : {}),
    ...(closesAt ? { closesAt: closesAt.toISOString() } : {}),
  };
  return {
    ...order,
    tickets: tickets.map((t) => ({ ...t, canSend: canSend && !t.transfer && !t.checkedInAt })),
    transfers,
  };
}

/**
 * Sends the transfer emails queued by a send, accept or decline straight
 * after the response. Empty in this release: nothing may lease a transfer
 * job before the code that can send it exists (the email builders and
 * delivery come next), and the cron's drain never leases these kinds (they
 * aren't named in its phases). The jobs wait in the outbox until then.
 */
export function ticketTransferJobsSoon(deps: Deps): void {
  void deps;
}

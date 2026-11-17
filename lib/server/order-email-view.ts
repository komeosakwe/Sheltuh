import type { Deps } from "./deps";
import { hasOrderAccess } from "./order-access";
import type { CustomerOrder, OrderEmailChange, OrderEmailChangeBlock } from "./types";

/**
 * What private.order_email_change_block says, as the API's reason (the 409
 * `code` of an email change, and CustomerOrder.emailChange.reason). Null for
 * an order that isn't a card checkout (or is gone): there's nothing for the
 * paying browser to change then.
 */
export function emailChangeBlockReason(block: string): OrderEmailChangeBlock | null {
  switch (block) {
    case "not_paid":
      return "order_not_paid";
    case "ended":
      return "event_ended";
    case "scanned":
      return "ticket_scanned";
    case "already_changed":
      return "email_already_changed";
    default:
      return null;
  }
}

/**
 * The order's email as `req` may see it (docs/architecture.md, "Buyer email
 * checks"), added to `order` (a settled order's CustomerOrder):
 * - the paying browser (the order's token in `x-order-access`), for a card
 *   order: the full address (`email`) and whether it may change it now
 *   (`emailChange`, from private.order_email_change_block);
 * - anyone else (the order id alone: the ticket email's link): the masked
 *   address only while the email has never been changed, and none once it
 *   has (owner decision Q7), so the old address's holder doesn't learn the
 *   new one, even masked.
 * One indexed query either way.
 */
export async function withOrderEmail(req: Request, deps: Deps, orderId: string, order: CustomerOrder): Promise<CustomerOrder> {
  if (hasOrderAccess(req, deps, orderId)) {
    const [row] = await deps.db.query<{ buyer_email: string | null; block: string | null }>(
      `select o.buyer_email, private.order_email_change_block(o.id) as block from public.orders o where o.id = $1`,
      [orderId],
    );
    if (row?.buyer_email) {
      const reason = row.block === null ? undefined : emailChangeBlockReason(row.block);
      if (reason !== null) {
        const emailChange: OrderEmailChange = reason === undefined ? { allowed: true } : { allowed: false, reason };
        return { ...order, email: row.buyer_email, emailChange };
      }
    }
  }
  const [changed] = await deps.db.query<{ changed: boolean }>(
    `select exists (select 1 from private.order_email_changes c where c.order_id = $1) as changed`,
    [orderId],
  );
  if (!changed?.changed) return order;
  const hidden = { ...order };
  delete hidden.maskedEmail;
  return hidden;
}

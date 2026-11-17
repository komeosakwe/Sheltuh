import { PG_UNDEFINED_FUNCTION, PG_UNDEFINED_TABLE, pgErrorCode, type Db } from "./db";
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
    case "changed_by_support":
      return "changed_by_support";
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
 *   order, until its event ends: the full address (`email`) and whether it
 *   may change it now (`emailChange`, from private.order_email_change_block);
 * - the paying browser once the event has ended: what anyone sees (below),
 *   with `emailChange: {allowed: false, reason: "event_ended"}`. The token
 *   lives on in that browser's storage for months, on a device that may not
 *   stay the buyer's; after the event there's nothing left to fix, so it no
 *   longer shows the address in full;
 * - the paying browser once the latest change is support's: neither the
 *   address nor the masked one, and `emailChange: {allowed: false, reason:
 *   "changed_by_support"}`: the token may be on a device the old address's
 *   holder still uses (the reason support was asked), so it mustn't show
 *   where the tickets went;
 * - anyone else (the order id alone: the ticket email's link): the masked
 *   address only while the email has never been changed, and none once it
 *   has (owner decision Q7), so the old address's holder doesn't learn the
 *   new one, even masked.
 * The browser forgets its token once told `event_ended`, `ticket_scanned`
 * or `changed_by_support` (lib/order-access.ts): none of them can change.
 * One indexed query either way.
 */
export async function withOrderEmail(req: Request, deps: Deps, orderId: string, order: CustomerOrder): Promise<CustomerOrder> {
  try {
    return await orderEmailFor(req, deps, orderId, order);
  } catch (err) {
    // The confirmation page is read straight after payment: never fail it for a deploy that's ahead of its migration.
    if (await changeLogMissing(deps.db, err)) return order;
    throw err;
  }
}

let warnedMissing = false;

/**
 * Whether `err` is the change log or its functions not existing yet (this
 * code deployed before 20261127000000_order_email_changes.sql), asked of the
 * catalogue; warned about once. The page then shows what it did before:
 * the masked address, and no change.
 */
async function changeLogMissing(db: Db, err: unknown): Promise<boolean> {
  const code = pgErrorCode(err);
  if (code !== PG_UNDEFINED_TABLE && code !== PG_UNDEFINED_FUNCTION) return false;
  try {
    const [row] = await db.query<{ missing: boolean }>(
      `select (to_regclass('private.order_email_changes') is null
               or to_regprocedure('private.order_email_change_block(text)') is null) as missing`,
    );
    if (row?.missing !== true) return false;
  } catch {
    return false;
  }
  if (!warnedMissing) {
    warnedMissing = true;
    console.warn("Buyer email changes: migration 20261127000000_order_email_changes.sql isn't applied; order pages show the masked email only until it is.");
  }
  return true;
}

async function orderEmailFor(req: Request, deps: Deps, orderId: string, order: CustomerOrder): Promise<CustomerOrder> {
  if (hasOrderAccess(req, deps, orderId)) {
    const [row] = await deps.db.query<{
      buyer_email: string | null;
      block: string | null;
      last_changed_by: string | null;
      ended: boolean;
    }>(
      `select o.buyer_email, private.order_email_change_block(o.id) as block,
              (select c.changed_by from private.order_email_changes c
                where c.order_id = o.id order by c.created_at desc, c.id desc limit 1) as last_changed_by,
              coalesce((select e.ends_at <= now() from public.events e where e.id = o.event_id), true) as ended
         from public.orders o where o.id = $1`,
      [orderId],
    );
    if (row?.last_changed_by === "admin") {
      const withheld: CustomerOrder = { ...order, emailChange: { allowed: false, reason: "changed_by_support" } };
      delete withheld.maskedEmail;
      return withheld;
    }
    // A card order (the block function says nothing for any other) whose event is over: as anyone sees it.
    if (row?.ended && row.block !== null && emailChangeBlockReason(row.block) !== null) {
      return { ...asAnyoneSees(order, row.last_changed_by !== null), emailChange: { allowed: false, reason: "event_ended" } };
    }
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
  return asAnyoneSees(order, changed?.changed === true);
}

/** The order as anyone holding its id sees it: the masked address until its email has been `changed`, none after. */
function asAnyoneSees(order: CustomerOrder, changed: boolean): CustomerOrder {
  if (!changed) return order;
  const hidden = { ...order };
  delete hidden.maskedEmail;
  return hidden;
}

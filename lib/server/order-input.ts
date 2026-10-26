import { formatAud } from "@/lib/format";
import { SUPPORT_LABEL, SUPPORT_MAX_CENTS, SUPPORT_MIN_CENTS } from "@/lib/support";
import { fail } from "./validation";
import type { OrderLineItem, TicketTypeInput } from "./types";

const MAX_QUANTITY_PER_LINE = 20;

interface RawLineItem {
  ticketTypeId?: unknown;
  quantity?: unknown;
}

interface RawCheckoutBody {
  lineItems?: unknown;
}

/**
 * Turns a checkout request's {ticketTypeId, quantity} pairs into real order
 * line items — priced and named from the event's own live ticketTypes, never
 * from anything the client sent. A client-submitted price would let a buyer
 * name their own total.
 */
export function parseCheckoutLineItems(body: RawCheckoutBody, eventTicketTypes: TicketTypeInput[]): OrderLineItem[] {
  const errors: Record<string, string> = {};
  const raw = body.lineItems;

  if (!Array.isArray(raw) || raw.length === 0) {
    fail({ lineItems: "Select at least one ticket." });
  }

  const byId = new Map(eventTicketTypes.map((t) => [t.id, t]));
  const result: OrderLineItem[] = [];
  const seen = new Set<string>();

  (raw as unknown[]).forEach((entry, i) => {
    const prefix = `lineItems[${i}]`;
    if (typeof entry !== "object" || entry === null) {
      errors[prefix] = "Invalid line item.";
      return;
    }
    const { ticketTypeId, quantity } = entry as RawLineItem;

    if (typeof ticketTypeId !== "string" || !byId.has(ticketTypeId)) {
      errors[`${prefix}.ticketTypeId`] = "Unknown ticket type — it may have changed since you loaded this page.";
      return;
    }
    // One line per ticket type: repeated lines would each pass the
    // availability and per-order checks separately while adding up past them.
    if (seen.has(ticketTypeId)) {
      errors[`${prefix}.ticketTypeId`] = "Each ticket type can only appear once per order.";
      return;
    }
    seen.add(ticketTypeId);
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
      errors[`${prefix}.quantity`] = "Quantity must be a whole number of 1 or more.";
      return;
    }
    if (quantity > MAX_QUANTITY_PER_LINE) {
      errors[`${prefix}.quantity`] = `Quantity can't exceed ${MAX_QUANTITY_PER_LINE} per order.`;
      return;
    }

    const ticketType = byId.get(ticketTypeId);
    if (!ticketType) return; // unreachable — byId.has() already checked above
    result.push({
      ticketTypeId: ticketType.id,
      ticketTypeName: ticketType.name,
      unitPriceCents: ticketType.priceCents,
      feePolicy: ticketType.feePolicy,
      quantity,
    });
  });

  if (Object.keys(errors).length > 0) fail(errors);
  if (result.length === 0) fail({ lineItems: "Select at least one ticket." });

  return result;
}

/**
 * A checkout request's optional `supportCents` (Support Sheltüh,
 * lib/support.ts): omitted, null or 0 is none (0); otherwise a whole number
 * of cents from SUPPORT_MIN_CENTS to SUPPORT_MAX_CENTS, else 400
 * `fieldErrors.supportCents`. Whether the order may carry it (a paid ticket)
 * is the caller's check (refuseSupportOnFreeOrder), once the order is priced.
 */
export function parseSupportCents(value: unknown): number {
  if (value === undefined || value === null || value === 0) return 0;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail({ supportCents: `${SUPPORT_LABEL} must be a whole number of cents.` });
  }
  if (value < SUPPORT_MIN_CENTS) fail({ supportCents: `${SUPPORT_LABEL} must be at least ${formatAud(SUPPORT_MIN_CENTS)}.` });
  if (value > SUPPORT_MAX_CENTS) fail({ supportCents: `${SUPPORT_LABEL} can be at most ${formatAud(SUPPORT_MAX_CENTS)}.` });
  return value;
}

/** Support Sheltüh only rides on a paid order (free orders never go through Stripe): 400 `fieldErrors.supportCents`. */
export function refuseSupportOnFreeOrder(supportCents: number, subtotalCents: number) {
  if (supportCents > 0 && subtotalCents <= 0) {
    fail({ supportCents: `${SUPPORT_LABEL} can only be added to an order with paid tickets.` });
  }
}

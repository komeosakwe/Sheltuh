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

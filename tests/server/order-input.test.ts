import { describe, expect, it } from "vitest";
import { HttpError } from "@/lib/server/http";
import { parseCheckoutLineItems } from "@/lib/server/order-input";
import type { TicketTypeInput } from "@/lib/server/types";

const TICKET_TYPES: TicketTypeInput[] = [
  { id: "ga", name: "General admission", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 100 },
  { id: "vip", name: "VIP", priceCents: 8000, feePolicy: "organiser-absorbs", quantityAvailable: 10 },
];

describe("parseCheckoutLineItems", () => {
  it("prices, names and fee-policies every line from the event's own live ticket types — never the client", () => {
    const result = parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: 2 }] }, TICKET_TYPES);
    expect(result).toEqual([
      { ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 3000, feePolicy: "buyer-pays", quantity: 2 },
    ]);
  });

  it("ignores a client-submitted price/name/feePolicy on the line item", () => {
    const result = parseCheckoutLineItems(
      { lineItems: [{ ticketTypeId: "ga", quantity: 1, unitPriceCents: 1, feePolicy: "organiser-absorbs" }] },
      TICKET_TYPES,
    );
    expect(result[0].unitPriceCents).toBe(3000);
    expect(result[0].feePolicy).toBe("buyer-pays");
  });

  it("rejects an unknown ticket type id", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "nope", quantity: 1 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
  });

  it("rejects a zero or negative quantity", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: 0 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: -1 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
  });

  it("rejects a non-integer quantity", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: 1.5 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
  });

  it("rejects an excessive quantity", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [{ ticketTypeId: "ga", quantity: 999 }] }, TICKET_TYPES)).toThrow(
      HttpError,
    );
  });

  it("rejects an empty lineItems array", () => {
    expect(() => parseCheckoutLineItems({ lineItems: [] }, TICKET_TYPES)).toThrow(HttpError);
  });

  it("rejects a missing lineItems field", () => {
    expect(() => parseCheckoutLineItems({}, TICKET_TYPES)).toThrow(HttpError);
  });

  it("accepts multiple distinct line items in one order", () => {
    const result = parseCheckoutLineItems(
      {
        lineItems: [
          { ticketTypeId: "ga", quantity: 2 },
          { ticketTypeId: "vip", quantity: 1 },
        ],
      },
      TICKET_TYPES,
    );
    expect(result).toHaveLength(2);
    expect(result[1].ticketTypeId).toBe("vip");
  });

  it("rejects the same ticket type on two lines, so quantities can't be split to dodge the limits", () => {
    const body = { lineItems: [{ ticketTypeId: "ga", quantity: 15 }, { ticketTypeId: "ga", quantity: 15 }] };
    try {
      parseCheckoutLineItems(body, TICKET_TYPES);
      throw new Error("expected a validation error");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).fieldErrors).toEqual({
        "lineItems[1].ticketTypeId": "Each ticket type can only appear once per order.",
      });
    }
  });
});

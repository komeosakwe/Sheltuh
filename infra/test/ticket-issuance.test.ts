import { describe, expect, it } from "vitest";
import { issueTickets } from "../lambda/shared/ticket-issuance";
import type { OrderLineItem } from "../lambda/shared/types";

describe("issueTickets", () => {
  it("issues one ticket per unit, not per line item", () => {
    const lineItems: OrderLineItem[] = [
      { ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 3000, feePolicy: "buyer-pays", quantity: 3 },
      { ticketTypeId: "vip", ticketTypeName: "VIP", unitPriceCents: 8000, feePolicy: "organiser-absorbs", quantity: 1 },
    ];
    const tickets = issueTickets(lineItems);
    expect(tickets).toHaveLength(4);
    expect(tickets.filter((t) => t.ticketTypeId === "ga")).toHaveLength(3);
    expect(tickets.filter((t) => t.ticketTypeId === "vip")).toHaveLength(1);
  });

  it("gives every ticket a unique code", () => {
    const lineItems: OrderLineItem[] = [
      { ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 3000, feePolicy: "buyer-pays", quantity: 50 },
    ];
    const codes = issueTickets(lineItems).map((t) => t.ticketCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("codes avoid visually ambiguous characters (0/O, 1/I)", () => {
    const lineItems: OrderLineItem[] = [
      { ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 20 },
    ];
    const codes = issueTickets(lineItems).map((t) => t.ticketCode);
    for (const code of codes) {
      expect(code).not.toMatch(/[01OI]/);
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { issueTickets } from "@/lib/server/ticket-issuance";
import type { OrderLineItem } from "@/lib/server/types";
import { TICKET_CODE_ALPHABET, TICKET_CODE_PATTERN } from "@/lib/ticket-code";

afterEach(() => {
  vi.restoreAllMocks();
});

const oneTicket: OrderLineItem[] = [
  { ticketTypeId: "ga", ticketTypeName: "General admission", unitPriceCents: 0, feePolicy: "buyer-pays", quantity: 1 },
];

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

  it("codes come from crypto.getRandomValues: 8 random bytes per ticket, one character each", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    const [ticket] = issueTickets(oneTicket);
    expect(spy).toHaveBeenCalledTimes(1);
    const bytes = spy.mock.calls[0][0] as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(8);
    expect(ticket.ticketCode).toMatch(TICKET_CODE_PATTERN);
    // The code is exactly those bytes mapped onto the alphabet, nothing else mixed in.
    const expected = Array.from(bytes, (b) => TICKET_CODE_ALPHABET[b % 32]).join("");
    expect(ticket.ticketCode.replace("-", "")).toBe(expected);
  });

  it("has no modulo bias: 32 letters divide 256, so every byte value maps to each letter exactly 8 times", () => {
    expect(TICKET_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(TICKET_CODE_ALPHABET).size).toBe(32);
    expect(256 % TICKET_CODE_ALPHABET.length).toBe(0);
    // Feed the generator every byte value once (32 codes x 8 bytes = 256 bytes, 0..255 in order).
    let next = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      const view = array as unknown as Uint8Array;
      for (let i = 0; i < view.length; i++) view[i] = next++;
      return array;
    });
    const codes = issueTickets([{ ...oneTicket[0], quantity: 32 }]).map((t) => t.ticketCode.replace("-", ""));
    expect(next).toBe(256);
    const counts = new Map<string, number>();
    for (const ch of codes.join("")) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(32);
    expect([...counts.values()].every((n) => n === 8)).toBe(true);
  });
});

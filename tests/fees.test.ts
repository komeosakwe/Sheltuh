import { describe, expect, it } from "vitest";
import {
  BOOKING_FEE_FLAT_CENTS,
  BOOKING_FEE_RATE,
  calculateBookingFeeCents,
  calculateOrderSummary,
  sumOrderSummaries,
} from "../lib/fees";

describe("calculateBookingFeeCents", () => {
  it("is 5% of face value plus A$0.50 for a paid ticket", () => {
    // A$30 ticket: round(3000 * 0.05) + 50 = 150 + 50 = 200 cents = A$2.
    expect(calculateBookingFeeCents(3000)).toBe(200);
  });

  it("is A$0 for a free ticket", () => {
    expect(calculateBookingFeeCents(0)).toBe(0);
  });

  it("rounds to the nearest cent", () => {
    // 5% of 1999 = 99.95 -> rounds to 100, + 50 flat = 150.
    expect(calculateBookingFeeCents(1999)).toBe(150);
  });

  it("matches the rate and flat constants directly", () => {
    const priceCents = 4200;
    const expected = Math.round(priceCents * BOOKING_FEE_RATE) + BOOKING_FEE_FLAT_CENTS;
    expect(calculateBookingFeeCents(priceCents)).toBe(expected);
  });
});

describe("calculateOrderSummary", () => {
  it("A$30 ticket, buyer pays fee: A$2 fee, A$32 total", () => {
    const summary = calculateOrderSummary(3000, 1, "buyer-pays");
    expect(summary.subtotalCents).toBe(3000);
    expect(summary.buyerFeeCents).toBe(200);
    expect(summary.totalCents).toBe(3200);
  });

  it("A$30 ticket, organiser absorbs fee: A$30 buyer total, no buyer fee", () => {
    const summary = calculateOrderSummary(3000, 1, "organiser-absorbs");
    expect(summary.subtotalCents).toBe(3000);
    expect(summary.buyerFeeCents).toBe(0);
    expect(summary.totalCents).toBe(3000);
  });

  it("free ticket carries no fee under either policy", () => {
    expect(calculateOrderSummary(0, 3, "buyer-pays")).toEqual({
      subtotalCents: 0,
      buyerFeeCents: 0,
      totalCents: 0,
    });
    expect(calculateOrderSummary(0, 3, "organiser-absorbs")).toEqual({
      subtotalCents: 0,
      buyerFeeCents: 0,
      totalCents: 0,
    });
  });

  it("scales linearly with quantity when the buyer pays the fee", () => {
    const summary = calculateOrderSummary(3000, 3, "buyer-pays");
    expect(summary.subtotalCents).toBe(9000);
    expect(summary.buyerFeeCents).toBe(600);
    expect(summary.totalCents).toBe(9600);
  });

  it("returns zeroed totals for zero quantity", () => {
    const summary = calculateOrderSummary(3000, 0, "buyer-pays");
    expect(summary).toEqual({ subtotalCents: 0, buyerFeeCents: 0, totalCents: 0 });
  });
});

describe("sumOrderSummaries", () => {
  // Mirrors how TicketSelector keys per-ticket-type quantities by ticket id
  // (Record<string, number>) and computes one summary per ticket type before
  // combining them. Distinct ticket types must contribute independently —
  // this is exactly the invariant a duplicate ticket id would break (see
  // lib/server/validation.ts's duplicate-id rejection).
  function orderForTicket(ticket: { priceCents: number; feePolicy: "buyer-pays" | "organiser-absorbs" }, quantitiesById: Record<string, number>, id: string) {
    return calculateOrderSummary(ticket.priceCents, quantitiesById[id] ?? 0, ticket.feePolicy);
  }

  it("combines two distinct ticket types (one buyer-pays, one organiser-absorbs) independently", () => {
    const ga = { id: "ga", priceCents: 3000, feePolicy: "buyer-pays" as const };
    const vip = { id: "vip", priceCents: 5500, feePolicy: "organiser-absorbs" as const };
    const quantitiesById = { ga: 1, vip: 1 };

    const total = sumOrderSummaries([
      orderForTicket(ga, quantitiesById, ga.id),
      orderForTicket(vip, quantitiesById, vip.id),
    ]);

    // GA: A$30 + A$2 fee = A$32. VIP: A$55, fee absorbed = A$55. Combined A$87.
    expect(total.subtotalCents).toBe(8500);
    expect(total.buyerFeeCents).toBe(200);
    expect(total.totalCents).toBe(8700);
  });

  it("changing one ticket type's quantity never affects another's contribution", () => {
    const ga = { id: "ga", priceCents: 3000, feePolicy: "buyer-pays" as const };
    const vip = { id: "vip", priceCents: 5500, feePolicy: "organiser-absorbs" as const };

    const baseline = sumOrderSummaries([
      orderForTicket(ga, { ga: 1, vip: 1 }, ga.id),
      orderForTicket(vip, { ga: 1, vip: 1 }, vip.id),
    ]);
    const gaQuantityDoubled = sumOrderSummaries([
      orderForTicket(ga, { ga: 2, vip: 1 }, ga.id),
      orderForTicket(vip, { ga: 2, vip: 1 }, vip.id),
    ]);

    // Only GA's contribution changes (+A$32); VIP's A$55 is unaffected.
    expect(gaQuantityDoubled.totalCents - baseline.totalCents).toBe(3200);
  });

  it("sums to zero for an empty order", () => {
    expect(sumOrderSummaries([])).toEqual({ subtotalCents: 0, buyerFeeCents: 0, totalCents: 0 });
  });
});

import { describe, expect, it } from "vitest";
import {
  BOOKING_FEE_FLAT_CENTS,
  BOOKING_FEE_RATE,
  calculateBookingFeeCents,
  describeBookingFee,
  calculateOrderSummary,
  MIN_PAID_TICKET_CENTS,
  sumOrderSummaries,
} from "../lib/fees";

describe("calculateBookingFeeCents", () => {
  it("is 6% of face value plus A$0.50 for a paid ticket", () => {
    // A$30 ticket: round(3000 * 0.06) + 50 = 180 + 50 = 230 cents = A$2.30.
    expect(calculateBookingFeeCents(3000)).toBe(230);
    // A$10 ticket: 60 + 50 = 110 cents = A$1.10.
    expect(calculateBookingFeeCents(1000)).toBe(110);
  });

  it("is A$0 for a free ticket", () => {
    expect(calculateBookingFeeCents(0)).toBe(0);
  });

  it("rounds to the nearest cent", () => {
    // 6% of 1999 = 119.94 -> rounds to 120, + 50 flat = 170.
    expect(calculateBookingFeeCents(1999)).toBe(170);
    // 6% of 1025 = 61.5 exactly -> half a cent rounds up to 62, + 50 flat = 112.
    expect(calculateBookingFeeCents(1025)).toBe(112);
  });

  it("stays below the cheapest paid ticket, so an organiser-absorbed fee never exceeds the payment", () => {
    // A$1.00: 6 + 50 = 56 cents, leaving the organiser A$0.44.
    expect(calculateBookingFeeCents(MIN_PAID_TICKET_CENTS)).toBe(56);
    expect(calculateBookingFeeCents(MIN_PAID_TICKET_CENTS)).toBeLessThan(MIN_PAID_TICKET_CENTS);
  });

  it("matches the rate and flat constants directly", () => {
    const priceCents = 4200;
    const expected = Math.round(priceCents * BOOKING_FEE_RATE) + BOOKING_FEE_FLAT_CENTS;
    expect(calculateBookingFeeCents(priceCents)).toBe(expected);
  });
});

describe("calculateOrderSummary", () => {
  it("A$30 ticket, buyer pays fee: A$2.30 fee, A$32.30 total", () => {
    const summary = calculateOrderSummary(3000, 1, "buyer-pays");
    expect(summary.subtotalCents).toBe(3000);
    expect(summary.buyerFeeCents).toBe(230);
    expect(summary.totalCents).toBe(3230);
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
    expect(summary.buyerFeeCents).toBe(690);
    expect(summary.totalCents).toBe(9690);
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

    // GA: A$30 + A$2.30 fee = A$32.30. VIP: A$55, fee absorbed = A$55. Combined A$87.30.
    expect(total.subtotalCents).toBe(8500);
    expect(total.buyerFeeCents).toBe(230);
    expect(total.totalCents).toBe(8730);
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

    // Only GA's contribution changes (+A$32.30); VIP's A$55 is unaffected.
    expect(gaQuantityDoubled.totalCents - baseline.totalCents).toBe(3230);
  });

  it("sums to zero for an empty order", () => {
    expect(sumOrderSummaries([])).toEqual({ subtotalCents: 0, buyerFeeCents: 0, totalCents: 0 });
  });
});

describe("describeBookingFee", () => {
  it("states the fee buyers are charged: 6% + A$0.50 per paid ticket", () => {
    expect(describeBookingFee()).toBe("6% of ticket face value + A$0.50 per paid ticket");
  });

  it("is built from the same constants calculateBookingFeeCents uses", () => {
    // A A$10 ticket: the description's percentage and flat amount give the charged fee.
    const [, percent, flatDollars] = describeBookingFee().match(/^([\d.]+)% .* \+ A\$([\d.]+) per paid ticket$/) ?? [];
    expect(Number(percent) / 100).toBe(BOOKING_FEE_RATE);
    expect(Math.round(Number(flatDollars) * 100)).toBe(BOOKING_FEE_FLAT_CENTS);
    expect(Math.round(1000 * (Number(percent) / 100)) + Math.round(Number(flatDollars) * 100)).toBe(
      calculateBookingFeeCents(1000),
    );
  });
});

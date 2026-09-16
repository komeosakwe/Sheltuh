import { describe, expect, it } from "vitest";
import {
  BOOKING_FEE_FLAT_CENTS,
  BOOKING_FEE_RATE,
  calculateBookingFeeCents,
  calculateOrderSummary,
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

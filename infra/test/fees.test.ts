import { describe, expect, it } from "vitest";
import { calculateBookingFeeCents, calculateOrderSummary } from "../lambda/shared/fees";

// Mirrors tests/pricing.test.ts's frontend fixtures exactly — this module
// is a deliberate duplicate of lib/fees.ts (see its own comment for why),
// so the two need to keep agreeing on every figure a buyer or organiser
// actually sees.
describe("calculateBookingFeeCents", () => {
  it("is 0 for a free ticket", () => {
    expect(calculateBookingFeeCents(0)).toBe(0);
  });

  it("is 5% + A$0.50 for a paid ticket, rounded", () => {
    expect(calculateBookingFeeCents(3000)).toBe(200); // 3000*0.05=150 + 50
    expect(calculateBookingFeeCents(2500)).toBe(175); // 2500*0.05=125 + 50
  });
});

describe("calculateOrderSummary", () => {
  it("buyer-pays: fee is added on top of the ticket subtotal", () => {
    const summary = calculateOrderSummary(3000, 2, "buyer-pays");
    expect(summary.subtotalCents).toBe(6000);
    expect(summary.buyerFeeCents).toBe(400); // 200 * 2
    expect(summary.totalCents).toBe(6400);
  });

  it("organiser-absorbs: the buyer's total never includes the fee", () => {
    const summary = calculateOrderSummary(3000, 2, "organiser-absorbs");
    expect(summary.subtotalCents).toBe(6000);
    expect(summary.buyerFeeCents).toBe(0);
    expect(summary.totalCents).toBe(6000);
  });

  it("a free ticket has no fee under either policy", () => {
    expect(calculateOrderSummary(0, 5, "buyer-pays").totalCents).toBe(0);
    expect(calculateOrderSummary(0, 5, "organiser-absorbs").totalCents).toBe(0);
  });
});

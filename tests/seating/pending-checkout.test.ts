// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { forgetPendingCheckout, rememberPendingCheckout, takePendingCheckout } from "@/lib/seating/pending-checkout";

const ORDER = `ord_${"b".repeat(32)}`;
const KEY = "sheltuh:pending-checkout";

beforeEach(() => window.sessionStorage.clear());

describe("the checkout this tab sent to Stripe (lib/seating/pending-checkout.ts)", () => {
  it("is taken once", () => {
    rememberPendingCheckout(ORDER, "off-kilter", 1_000);
    expect(takePendingCheckout(2_000)).toEqual({ orderId: ORDER, slug: "off-kilter", at: 1_000 });
    expect(takePendingCheckout(2_000)).toBeNull();
  });

  it("is dropped once the hold would have lapsed by itself (35 minutes)", () => {
    rememberPendingCheckout(ORDER, "off-kilter", 0);
    expect(takePendingCheckout(35 * 60_000 + 1)).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("ignores anything that isn't an order id, or isn't readable", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ orderId: "../admin", slug: "x", at: 0 }));
    expect(takePendingCheckout(1)).toBeNull();
    window.sessionStorage.setItem(KEY, "{not json");
    expect(takePendingCheckout(1)).toBeNull();
  });

  it("is forgotten for that order only (paid, or released on the cancelled page)", () => {
    rememberPendingCheckout(ORDER, "off-kilter", 0);
    forgetPendingCheckout(`ord_${"c".repeat(32)}`);
    expect(window.sessionStorage.getItem(KEY)).not.toBeNull();
    forgetPendingCheckout(ORDER);
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});

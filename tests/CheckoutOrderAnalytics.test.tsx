// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";
import type { CustomerOrder } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ session_id: "ord_secret123" }),
}));
const getOrderBySession = vi.fn();
vi.mock("@/lib/api/orders", async (importOriginal) => ({
  walletPassUrl: (await importOriginal<typeof import("@/lib/api/orders")>()).walletPassUrl,
  getOrderBySession: (...args: unknown[]) => getOrderBySession(...args),
  getOrderPayment: vi.fn(),
}));
const trackOrderCompleted = vi.fn();
vi.mock("@/lib/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/analytics")>()),
  trackOrderCompleted: (...args: unknown[]) => trackOrderCompleted(...args),
}));

const PAID: CustomerOrder = {
  status: "paid",
  reference: "#7C1F2E0A",
  eventTitle: "Neon Static",
  eventSlug: "neon-static",
  subtotalCents: 3000,
  buyerFeeCents: 230,
  supportCents: 100,
  totalCents: 3330,
  tickets: [
    { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission", checkedInAt: null },
    { ticketCode: "A2B3-C4D5", ticketTypeName: "General admission", checkedInAt: null },
  ],
};

beforeEach(() => {
  trackOrderCompleted.mockReset();
  getOrderBySession.mockReset();
});
afterEach(cleanup);

describe("the success page's order_completed", () => {
  it("reports a paid order once, with its value in dollars, ticket count and flags, and no order id", async () => {
    getOrderBySession.mockResolvedValue(PAID);
    render(<CheckoutConfirmation />);
    await screen.findByText("Order reference #7C1F2E0A");
    await waitFor(() => expect(trackOrderCompleted).toHaveBeenCalledTimes(1));
    const [orderId, properties] = trackOrderCompleted.mock.calls[0];
    // The order id is only the lookup for "this tab started this order" (lib/analytics.ts); it is not a property.
    expect(orderId).toBe("ord_secret123");
    expect(properties).toEqual({ event_slug: "neon-static", value_aud: 33.3, ticket_count: 2, has_support: true, free: false });
    expect(JSON.stringify(properties)).not.toMatch(/ord_|7KQM|#7C1F/);
  });

  it("reports a free order with a value of 0", async () => {
    getOrderBySession.mockResolvedValue({ ...PAID, subtotalCents: 0, buyerFeeCents: 0, supportCents: undefined, totalCents: 0 });
    render(<CheckoutConfirmation />);
    await screen.findByText("Order reference #7C1F2E0A");
    await waitFor(() => expect(trackOrderCompleted).toHaveBeenCalledTimes(1));
    expect(trackOrderCompleted.mock.calls[0][1]).toMatchObject({ value_aud: 0, free: true, has_support: false });
  });

  it("reports nothing for an order that was refunded or isn't found", async () => {
    getOrderBySession.mockResolvedValue({ ...PAID, status: "refunded", refundReason: "refunded", tickets: [] });
    render(<CheckoutConfirmation />);
    await screen.findByText("This order has been refunded");
    expect(trackOrderCompleted).not.toHaveBeenCalled();
  });
});

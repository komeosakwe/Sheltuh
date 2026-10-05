// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";
import type { OrderRecord } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ session_id: "cs_test_1" }),
}));
const getOrderBySession = vi.fn();
vi.mock("@/lib/api/orders", () => ({
  getOrderBySession: (...args: unknown[]) => getOrderBySession(...args),
}));

afterEach(() => {
  cleanup();
  getOrderBySession.mockReset();
});

const ORDER: OrderRecord = {
  orderId: "ord-1",
  organiserId: "org-1",
  eventId: "evt-1",
  eventTitle: "Neon Static",
  eventSlug: "neon-static",
  buyerEmail: "mia@example.com",
  lineItems: [],
  subtotalCents: 3000,
  buyerFeeCents: 170,
  totalCents: 3170,
  applicationFeeCents: 170,
  status: "paid",
  tickets: [{ ticketCode: "ABC123", ticketTypeId: "tt-1", ticketTypeName: "General admission" }],
  createdAt: "2026-09-30T00:00:00.000Z",
  updatedAt: "2026-09-30T00:00:00.000Z",
};

describe("CheckoutConfirmation", () => {
  it("links back to the event and to its Who's Going panel", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("link", { name: "Add yourself to Who’s Going" })).toHaveAttribute(
      "href",
      "/events/neon-static#whos-going",
    );
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    expect(getOrderBySession).toHaveBeenCalledWith("cs_test_1");
  });

  it("without an event slug (an older API), only links home", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, eventSlug: "" });
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Back to the event" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add yourself to Who’s Going" })).toBeNull();
  });
});

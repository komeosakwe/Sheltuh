// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";
import type { CustomerOrder } from "@/lib/api/types";

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

const ORDER: CustomerOrder = {
  status: "paid",
  reference: "#7C1F2E0A",
  eventTitle: "Neon Static",
  eventSlug: "neon-static",
  maskedEmail: "m***@example.com",
  subtotalCents: 3000,
  buyerFeeCents: 170,
  totalCents: 3170,
  tickets: [{ ticketCode: "ABC123", ticketTypeName: "General admission" }],
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

  it("shows the masked email and the order reference, never a full address", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("We’re emailing your tickets to m***@example.com.")).toBeInTheDocument();
    expect(screen.getByText("Order reference #7C1F2E0A")).toBeInTheDocument();
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/mia@/);
  });

  it("without an event slug (an older API), only links home", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, eventSlug: undefined });
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Back to the event" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add yourself to Who’s Going" })).toBeNull();
  });

  it("tells the buyer a paid order was refunded and shows no codes", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status: "refunded", refundReason: "refunded", tickets: [] });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("This order has been refunded")).toBeInTheDocument();
    expect(screen.getByText(/tickets for this order are no longer valid/)).toBeInTheDocument();
    expect(screen.queryByText(/no tickets were issued/)).toBeNull();
    expect(screen.queryByText("ABC123")).toBeNull();
  });

  it("keeps the sold-out wording for an oversold refund", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status: "oversold_refund_required", refundReason: "oversold", tickets: [] });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("We couldn\u2019t reserve your tickets")).toBeInTheDocument();
    expect(screen.getByText(/no tickets were issued/)).toBeInTheDocument();
  });
});

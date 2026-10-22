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
  tickets: [{ ticketCode: "ABC123", ticketTypeName: "General admission", checkedInAt: null }],
};

/** What the current API returns for a paid order: the event's details and each ticket's check-in status. */
const WITH_DETAILS: CustomerOrder = {
  ...ORDER,
  eventStartsAt: "2027-03-06T09:00:00.000Z", // 8:00 pm AEDT
  eventEndsAt: "2027-03-06T12:30:00.000Z",
  venueName: "The Tote",
  suburb: "Collingwood",
  tickets: [
    { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission", checkedInAt: "2027-03-06T09:42:00.000Z" },
    { ticketCode: "A2B3-C4D5", ticketTypeName: "VIP", checkedInAt: null },
  ],
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

  it("shows the totals in a white card with a black border, Total paid the largest number (§6.8, §6.9)", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    const totalTerm = await screen.findByText("Total paid");
    const totalValue = totalTerm.nextElementSibling;
    expect(totalValue).toHaveTextContent("A$31.70");
    expect(totalValue).toHaveClass("text-xl", "font-bold", "tabular-nums");
    const card = totalTerm.closest("dl")?.parentElement;
    expect(card).toHaveClass("rounded-card", "border", "border-foreground", "bg-card", "p-4");
    expect(card).not.toHaveClass("bg-surface");
    expect(screen.getByText("Ticket subtotal").nextElementSibling).toHaveClass("tabular-nums");
  });

  it("without an event slug (an older API), only links home", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, eventSlug: undefined });
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "Back to the event" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add yourself to Who’s Going" })).toBeNull();
  });

  it("shows a QR and the text code for each ticket, numbered as in the email, with the door advice", async () => {
    getOrderBySession.mockResolvedValue({
      ...ORDER,
      tickets: [
        { ticketCode: "7KQM-2HXD", ticketTypeName: "General admission" },
        { ticketCode: "A2B3-C4D5", ticketTypeName: "General admission" },
      ],
    });
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code for ticket A2B3-C4D5" })).toBeInTheDocument();
    expect(screen.getByText("7KQM-2HXD")).toBeInTheDocument();
    expect(screen.getByText("A2B3-C4D5")).toBeInTheDocument();
    expect(screen.getByText("Ticket 1 of 2 · General admission")).toBeInTheDocument();
    expect(screen.getByText("Ticket 2 of 2 · General admission")).toBeInTheDocument();
    expect(screen.getAllByText("Turn your brightness up at the door.")).toHaveLength(2);
    expect(screen.getByText("Show a QR code at the door, from this page or your ticket email.")).toBeInTheDocument();
    expect(
      screen.getByText("This page needs a connection. If signal at the venue is patchy, take a screenshot first."),
    ).toBeInTheDocument();
    expect(screen.getByText("Each code gets in once, so don’t post or share it.")).toBeInTheDocument();
    expect(screen.queryByText("Show this page or your ticket email at the door.")).toBeNull();
  });

  it("shows a code that isn't a real one as text only, with no QR", async () => {
    getOrderBySession.mockResolvedValue(ORDER);
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("tells the buyer a paid order was refunded and shows no codes", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status: "refunded", refundReason: "refunded", tickets: [] });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("This order has been refunded")).toBeInTheDocument();
    expect(screen.getByText(/tickets for this order are no longer valid/)).toBeInTheDocument();
    expect(screen.queryByText(/no tickets were issued/)).toBeNull();
    expect(screen.queryByText("ABC123")).toBeNull();
  });

  it("shows no QR or code for a refunded order, even if a response still carried its tickets", async () => {
    getOrderBySession.mockResolvedValue({
      ...ORDER,
      status: "refunded",
      refundReason: "refunded",
      tickets: [{ ticketCode: "7KQM-2HXD", ticketTypeName: "General admission" }],
    });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("This order has been refunded")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("7KQM-2HXD")).toBeNull();
    expect(screen.queryByText(/Show a QR code at the door/)).toBeNull();
  });

  it("shows each ticket's event, date, venue, type, QR, backup code and status", async () => {
    getOrderBySession.mockResolvedValue(WITH_DETAILS);
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
    const tickets = screen.getAllByRole("listitem");
    expect(tickets).toHaveLength(2);
    for (const [i, ticket] of tickets.entries()) {
      const text = ticket.textContent ?? "";
      expect(text).toContain("Neon Static");
      expect(text).toContain("Sat 6 Mar, 8:00 pm – 11:30 pm");
      expect(text).toContain("The Tote, Collingwood");
      expect(text).toContain("Backup code");
      expect(text).toContain(WITH_DETAILS.tickets[i].ticketCode);
    }
    expect(tickets[0].textContent).toContain("Ticket 1 of 2 · General admission");
    expect(tickets[0].textContent).toMatch(/Checked in (Sat 6 Mar( 2027)?, )?8:42 pm/);
    expect(tickets[1].textContent).toContain("Ticket 2 of 2 · VIP");
    expect(tickets[1].textContent).toContain("Ready to scan");
    // Both keep their QR.
    expect(screen.getByRole("img", { name: "QR code for ticket A2B3-C4D5" })).toBeInTheDocument();
  });

  it("from an older API (no event details or check-in status), shows the tickets without them", async () => {
    getOrderBySession.mockResolvedValue({
      ...ORDER,
      tickets: [{ ticketCode: "7KQM-2HXD", ticketTypeName: "General admission" }],
    });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("7KQM-2HXD")).toBeInTheDocument();
    expect(screen.getByText("Ready to scan")).toBeInTheDocument();
    expect(screen.queryByText(/Checked in/)).toBeNull();
    expect(screen.getByRole("listitem").textContent).not.toMatch(/Collingwood|8:00 pm/);
  });

  it("shows a refunded order's refund copy, with no QR, date or venue, whatever the response carried", async () => {
    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, status: "refunded", refundReason: "refunded" });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("This order has been refunded")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/Checked in|Ready to scan|Backup code/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/7KQM-2HXD|The Tote/);
  });

  it("for an event that's no longer listed, keeps the tickets and QRs but shows the support line instead of its date and venue", async () => {
    // A buggy or older response that still carried details must not show them either.
    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, eventListed: false });
    render(<CheckoutConfirmation />);
    expect(await screen.findByRole("img", { name: "QR code for ticket 7KQM-2HXD" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "QR code for ticket A2B3-C4D5" })).toBeInTheDocument();
    const tickets = screen.getAllByRole("listitem");
    expect(tickets).toHaveLength(2);
    for (const [i, ticket] of tickets.entries()) {
      const text = ticket.textContent ?? "";
      expect(text).toContain("Neon Static");
      expect(text).toContain(
        "This event is no longer listed. Contact support@sheltuh.com.au if you have questions.",
      );
      expect(text).toContain(WITH_DETAILS.tickets[i].ticketCode);
      expect(text).not.toMatch(/8:00 pm|Sat 6 Mar, |The Tote|Collingwood/);
    }
    for (const link of screen.getAllByRole("link", { name: "support@sheltuh.com.au" })) {
      expect(link).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    }
    // The event's page is gone: no links to it.
    expect(screen.queryByRole("link", { name: "Back to the event" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Add yourself to Who’s Going" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
  });

  it("a listed event (eventListed true) shows its details and no support line", async () => {
    getOrderBySession.mockResolvedValue({ ...WITH_DETAILS, eventListed: true });
    render(<CheckoutConfirmation />);
    expect(await screen.findAllByText("The Tote, Collingwood")).toHaveLength(2);
    expect(screen.queryByText(/no longer listed/)).toBeNull();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
  });

  it("keeps the sold-out wording for an oversold refund", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status: "oversold_refund_required", refundReason: "oversold", tickets: [] });
    render(<CheckoutConfirmation />);
    expect(await screen.findByText("We couldn\u2019t reserve your tickets")).toBeInTheDocument();
    expect(screen.getByText(/no tickets were issued/)).toBeInTheDocument();
  });
});

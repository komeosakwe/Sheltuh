// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CheckoutConfirmation from "@/components/CheckoutConfirmation";
import type { CustomerOrder, OrderPaymentLookup } from "@/lib/api/types";
import { rememberPendingCheckout } from "@/lib/seating/pending-checkout";

// The real next/link, marked, so a test can tell its links from plain ones (a full page load).
vi.mock("next/link", async (importOriginal) => {
  const { default: RealLink } = await importOriginal<typeof import("next/link")>();
  return { default: (props: ComponentProps<typeof RealLink>) => <RealLink {...props} data-next-link="" /> };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams({ session_id: "cs_test_1" }),
}));
const getOrderBySession = vi.fn();
const getOrderPayment = vi.fn();
// The writes the page must never make (it only reads).
const writes = { createCheckoutSession: vi.fn(), confirmFreeOrder: vi.fn(), cancelPendingOrder: vi.fn() };
vi.mock("@/lib/api/orders", () => ({
  getOrderBySession: (...args: unknown[]) => getOrderBySession(...args),
  getOrderPayment: (...args: unknown[]) => getOrderPayment(...args),
  createCheckoutSession: (...args: unknown[]) => writes.createCheckoutSession(...args),
  confirmFreeOrder: (...args: unknown[]) => writes.confirmFreeOrder(...args),
}));
vi.mock("@/lib/api/seating", () => ({
  cancelPendingOrder: (...args: unknown[]) => writes.cancelPendingOrder(...args),
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  sessionStorage.clear();
  getOrderBySession.mockReset();
  getOrderPayment.mockReset();
  for (const fn of Object.values(writes)) fn.mockReset();
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

describe("CheckoutConfirmation: back from Stripe without a confirmed order (checkout-pay.md §5.5)", () => {
  /** Renders with the order still pending, and lets `polls` polls (2s apart) happen. */
  async function renderPending(polls: number) {
    vi.useFakeTimers();
    getOrderBySession.mockResolvedValue({ status: "pending" });
    render(<CheckoutConfirmation />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (let i = 1; i < polls; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    }
  }

  function noWrites() {
    for (const fn of Object.values(writes)) expect(fn).not.toHaveBeenCalled();
  }

  it("asks Stripe's side only after two pending polls", async () => {
    getOrderPayment.mockResolvedValue({ status: "processing", delayed: false });
    await renderPending(1);
    expect(getOrderPayment).not.toHaveBeenCalled();
    expect(screen.getByText("This only takes a moment.")).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    expect(getOrderPayment).toHaveBeenCalledWith("cs_test_1");
  });

  it("still open: payment not completed, back to the payment page, and polling stops", async () => {
    getOrderPayment.mockResolvedValue({
      status: "open",
      clientSecret: "cs_secret",
      expiresAt: "2027-03-06T09:31:00.000Z",
      eventTitle: "Neon Static",
      eventSlug: "neon-static",
      seated: false,
      lines: [],
      subtotalCents: 3000,
      buyerFeeCents: 170,
      totalCents: 3170,
    });
    await renderPending(2);
    const h1 = screen.getByRole("heading", { level: 1, name: "Payment not completed" });
    expect(h1).toHaveFocus();
    expect(
      screen.getByText("You haven’t been charged. Your checkout is still open, so you can try again."),
    ).toBeInTheDocument();
    // Focused by script, not a control: no ring. Balanced, as every message's h1.
    expect(h1).toHaveClass("focus:outline-none!", "text-balance");
    const again = screen.getByRole("link", { name: "Return to payment" });
    expect(again.tagName).toBe("A");
    expect(again).toHaveAttribute("href", "/checkout/pay?order=cs_test_1");
    expect(again).toHaveClass("btn", "btn-solid", "btn-lg", "w-full", "sm:w-auto");
    expect(again.parentElement).toHaveClass("mt-3");
    // A plain link, so a full page load: /checkout/pay gets its own document and Content Security Policy.
    expect(again).not.toHaveAttribute("data-next-link");
    const back = screen.getByRole("link", { name: "Back to the event" });
    expect(back).toHaveAttribute("href", "/events/neon-static");
    // The page's other links stay client-side (and prove the marker below works).
    expect(back).toHaveAttribute("data-next-link");
    // Never the client secret on screen.
    expect(document.body.textContent).not.toContain("cs_secret");
    const polls = getOrderBySession.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getOrderBySession.mock.calls.length).toBe(polls);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    noWrites();
  });

  it("still open, seated with no event page: says when the seats are held until, and goes home", async () => {
    getOrderPayment.mockResolvedValue({
      status: "open",
      clientSecret: "cs_secret",
      expiresAt: "2027-03-06T09:31:00.000Z", // 8:31 pm AEDT
      eventTitle: "Off-Kilter",
      seated: true,
      lines: [],
      subtotalCents: 3000,
      buyerFeeCents: 170,
      totalCents: 3170,
    });
    await renderPending(2);
    expect(
      screen.getByText(
        "You haven’t been charged. Your checkout is still open, so you can try again. Your seats are held until 8:31 pm Melbourne time.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
  });

  it("processing: keeps polling, then says the payment is processing (not an error)", async () => {
    getOrderPayment.mockResolvedValue({ status: "processing", delayed: true });
    await renderPending(12);
    const h1 = screen.getByRole("heading", { level: 1, name: "Your payment is processing" });
    expect(h1).toHaveFocus();
    const body = screen.getByText(
      "Some payment methods take a little longer to clear. We’ll email your tickets as soon as it does; you don’t need to keep this page open. You won’t be charged twice.",
    );
    expect(body).toHaveClass("text-muted");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to Sheltüh" })).toHaveAttribute("href", "/");
    expect(getOrderBySession).toHaveBeenCalledTimes(12);
    expect(getOrderPayment).toHaveBeenCalledTimes(1);
    noWrites();
  });

  it("the check failing changes nothing: polling carries on to today's timeout message", async () => {
    getOrderPayment.mockRejectedValue(new TypeError("Failed to fetch"));
    await renderPending(12);
    expect(screen.getByRole("alert")).toHaveTextContent("Your payment is taking longer than usual to confirm.");
  });

  it("closed: says so, with the way back to the event", async () => {
    getOrderPayment.mockResolvedValue({ status: "closed", eventTitle: "Neon Static", eventSlug: "neon-static", seated: true });
    await renderPending(2);
    expect(screen.getByRole("heading", { level: 1, name: "This checkout has closed" })).toHaveFocus();
    expect(
      screen.getByText(
        "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged, and any seats held for you have been released.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
  });

  it("sold out, seated: choose other seats", async () => {
    getOrderPayment.mockResolvedValue({ status: "sold_out", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true });
    await renderPending(2);
    expect(screen.getByRole("heading", { level: 1, name: "These tickets have just sold out" })).toHaveFocus();
    expect(
      screen.getByText(
        "Some of your seats were booked by someone else while this checkout was open. You haven’t been charged. Choose other seats to continue.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Choose other seats" })).toHaveAttribute("href", "/events/off-kilter/seats");
    noWrites();
  });

  it("sold out, general admission: back to the event", async () => {
    getOrderPayment.mockResolvedValue({ status: "sold_out", eventTitle: "Neon Static", eventSlug: "neon-static", seated: false });
    await renderPending(2);
    expect(
      screen.getByText("Someone else booked the last ones while this checkout was open. You haven’t been charged."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the event" })).toHaveAttribute("href", "/events/neon-static");
  });

  it("paid by the next poll: the tickets, and the payment isn't asked about", async () => {
    getOrderBySession.mockResolvedValueOnce({ status: "pending" }).mockResolvedValue(ORDER);
    vi.useFakeTimers();
    render(<CheckoutConfirmation />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(getOrderPayment).not.toHaveBeenCalled();
  });
});

describe("CheckoutConfirmation: the seat page's pending checkout (released on Back until the order settles)", () => {
  const KEY = "sheltuh:pending-checkout";
  const OPEN: OrderPaymentLookup = {
    status: "open",
    clientSecret: "cs_secret",
    expiresAt: "2027-03-06T09:31:00.000Z",
    eventTitle: "Off-Kilter",
    eventSlug: "off-kilter",
    seated: true,
    lines: [],
    subtotalCents: 3000,
    buyerFeeCents: 170,
    totalCents: 3170,
  };

  beforeEach(() => {
    // The seat page stored this order as it went to pay (the page's session_id is the order id).
    rememberPendingCheckout("cs_test_1", "off-kilter");
  });

  async function settle(polls: number) {
    vi.useFakeTimers();
    render(<CheckoutConfirmation />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    for (let i = 1; i < polls; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
    }
  }

  it("isn't forgotten just by arriving: while the order is still pending, it's kept", async () => {
    getOrderBySession.mockResolvedValue({ status: "pending" });
    getOrderPayment.mockReturnValue(new Promise(() => undefined));
    await settle(1);
    expect(screen.getByText("This only takes a moment.")).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toContain("cs_test_1");
  });

  it.each([
    ["payment not completed (still open)", OPEN, "Payment not completed"],
    ["closed", { status: "closed", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true }, "This checkout has closed"],
    ["sold out", { status: "sold_out", eventTitle: "Off-Kilter", eventSlug: "off-kilter", seated: true }, "These tickets have just sold out"],
  ] as const)("%s: kept, so Back to the seat page still releases the seats", async (_name, answer, title) => {
    getOrderBySession.mockResolvedValue({ status: "pending" });
    getOrderPayment.mockResolvedValue(answer);
    await settle(2);
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toContain("cs_test_1");
  });

  it("paid: forgotten", async () => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status: "paid" });
    await settle(1);
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it.each([["oversold_refund_required"], ["refunded"]] as const)("%s: forgotten", async (status) => {
    getOrderBySession.mockResolvedValue({ ...ORDER, status, tickets: [] });
    await settle(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/refunded|couldn’t reserve/);
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("processing (Stripe has the payment): forgotten", async () => {
    getOrderBySession.mockResolvedValue({ status: "pending" });
    getOrderPayment.mockResolvedValue({ status: "processing", delayed: true });
    await settle(11);
    expect(sessionStorage.getItem(KEY)).toContain("cs_test_1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("heading", { level: 1, name: "Your payment is processing" })).toBeInTheDocument();
    expect(sessionStorage.getItem(KEY)).toBeNull();
  });

  it("an error (couldn't load the order): kept", async () => {
    getOrderBySession.mockRejectedValue(new TypeError("Failed to fetch"));
    await settle(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your order right now.");
    expect(sessionStorage.getItem(KEY)).toContain("cs_test_1");
  });
});

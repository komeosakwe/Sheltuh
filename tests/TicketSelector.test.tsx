// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TicketSelector from "@/components/TicketSelector";
import { ApiError } from "@/lib/api/client";
import { describeBookingFeeNote } from "@/lib/fees";
import { sampleEvents } from "@/lib/sample-events";
import { setTrackingRef } from "@/lib/tracking-ref";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

// Live mode: checkout is only offered when the API is configured.
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const createCheckoutSession = vi.fn();
vi.mock("@/lib/api/orders", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));

afterEach(() => {
  cleanup();
  createCheckoutSession.mockReset();
  window.sessionStorage.clear();
});

function findEvent(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`Fixture event not found: ${slug}`);
  return event;
}

/** Sample events have no organiser; a live event always does. */
function live(slug: string): SheltuhEvent {
  return { ...findEvent(slug), organiserId: "org-1" };
}

describe("TicketSelector (live)", () => {
  it("offers a 48px (btn-lg) Checkout, enabled once a ticket is chosen", () => {
    render(<TicketSelector event={live("neon-static")} />);
    // Nothing chosen yet: a paid event, so the (disabled) button already reads "Checkout".
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(checkout).toHaveClass("btn-lg");
    expect(checkout).toBeEnabled();
  });

  it("shows each ticket's all-inclusive price", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getByText("A$32.30 incl. booking fee")).toBeInTheDocument();
    expect(screen.getByText("A$55 incl. booking fee")).toBeInTheDocument();
  });

  it("free orders ask for an email (16px, 48px field) and announce a bad one", () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    const email = screen.getByLabelText("Email for your tickets");
    expect(email).toHaveClass("min-h-12", "text-base");
    fireEvent.change(email, { target: { value: "not-an-email" } });
    fireEvent.click(screen.getByRole("button", { name: "Get free tickets" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the email address to send your tickets to.");
    expect(email).toHaveAttribute("aria-invalid", "true");
    // Both the hint and the error describe the field.
    expect(email).toHaveAccessibleDescription(
      "We’ll send your tickets here. Booking with your Sheltüh account email also lets you add yourself to Who’s Going. Enter the email address to send your tickets to.",
    );
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe("TicketSelector (live, signed in)", () => {
  function renderSignedIn(slug: string) {
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <TicketSelector event={live(slug)} />
      </FakeAuthProvider>,
    );
  }

  it("prefills a free order's email from the account and says why it matters for Who's Going", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    renderSignedIn("brunswick-zine-fair");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    const email = screen.getByLabelText("Email for your tickets");
    expect(email).toHaveValue("mia@example.com");
    expect(email).toHaveAccessibleDescription(
      "We’ll send your tickets here. Booking with your Sheltüh account email also lets you add yourself to Who’s Going.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Get free tickets" }));
    // Signed in: a free order carries the account's token, so booking with
    // the account's own email issues the tickets straight away.
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.any(String),
      [{ ticketTypeId: expect.any(String), quantity: 1 }],
      "mia@example.com",
      undefined,
      expect.any(Function),
      // No Support Sheltüh on a free order.
      undefined,
    );
  });

  it("lets the buyer replace the prefilled email, including clearing it", () => {
    renderSignedIn("brunswick-zine-fair");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    const email = screen.getByLabelText("Email for your tickets");
    fireEvent.change(email, { target: { value: "" } });
    expect(email).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Get free tickets" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the email address to send your tickets to.");
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("books paid tickets with the account email, and says so before Checkout", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    renderSignedIn("neon-static");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const hint = screen.getByText(
      "Booking as mia@example.com, your account email, so you can add yourself to Who’s Going.",
    );
    const checkout = screen.getByRole("button", { name: "Checkout" });
    // The hint is read before the button, not after it.
    expect(hint.compareDocumentPosition(checkout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(checkout);
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.any(String),
      [{ ticketTypeId: expect.any(String), quantity: 1 }],
      "mia@example.com",
      undefined,
      undefined,
      // Nothing pre-selected: no Support Sheltüh unless the buyer picks some.
      undefined,
    );
  });
});

describe("TicketSelector (live, no auth)", () => {
  it("leaves the email empty and doesn't mention an account email", () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    expect(screen.getByLabelText("Email for your tickets")).toHaveValue("");
    expect(screen.queryByText(/Booking as/)).toBeNull();
  });

  it("sends no email with a signed-out paid order (Stripe collects it)", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    expect(screen.queryByText(/Booking as/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.any(String), expect.any(Array), undefined, undefined, undefined, undefined);
  });
});

describe("TicketSelector (free tickets)", () => {
  /** A live event with two free ticket types, plenty of each. */
  function freeEvent(): SheltuhEvent {
    const base = live("brunswick-zine-fair");
    return {
      ...base,
      ticketTypes: [
        { ...base.ticketTypes[0], id: "free-a", name: "Free entry", priceCents: 0, quantityAvailable: 50 },
        { ...base.ticketTypes[0], id: "free-b", name: "Kids", priceCents: 0, quantityAvailable: 50 },
      ],
    };
  }

  /** A live event with a paid type and two free types. */
  function mixedEvent(): SheltuhEvent {
    const base = freeEvent();
    return {
      ...base,
      ticketTypes: [
        { ...base.ticketTypes[0], id: "paid", name: "Supporter", priceCents: 2000, quantityAvailable: 50 },
        ...base.ticketTypes,
      ],
    };
  }

  it("caps free tickets at 4 per booking in total, across free ticket types, and says so", () => {
    render(<TicketSelector event={freeEvent()} />);
    const moreA = screen.getByRole("button", { name: "Increase quantity for Free entry" });
    const moreB = screen.getByRole("button", { name: "Increase quantity for Kids" });
    expect(moreA).toHaveAccessibleDescription("Up to 4 free tickets per booking, in total across the free ticket types.");
    for (let i = 0; i < 3; i++) fireEvent.click(moreA);
    expect(moreA).toHaveAttribute("aria-disabled", "false");
    fireEvent.click(moreB);
    expect(moreA).toHaveAttribute("aria-disabled", "true");
    expect(moreB).toHaveAttribute("aria-disabled", "true");
    expect(moreB).toHaveAccessibleDescription(
      "That's the most free tickets one booking can have (4 in total, across the free ticket types).",
    );
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity for Free entry" }));
    expect(moreB).toHaveAttribute("aria-disabled", "false");
  });

  it("keeps focus on a stepper that reaches its limit, and a press there changes nothing", async () => {
    createCheckoutSession.mockRejectedValue(new ApiError(409, "Those tickets just ran out."));
    render(<TicketSelector event={freeEvent()} />);
    const more = screen.getByRole("button", { name: "Increase quantity for Free entry" });
    const fewer = screen.getByRole("button", { name: "Decrease quantity for Free entry" });
    // At 0, "−" is marked unavailable but stays focusable (not `disabled`).
    expect(fewer).toHaveAttribute("aria-disabled", "true");
    expect(fewer).not.toBeDisabled();
    fewer.focus();
    expect(fewer).toHaveFocus();

    more.focus();
    for (let i = 0; i < 4; i++) fireEvent.click(more);
    expect(more).toHaveAttribute("aria-disabled", "true");
    expect(more).not.toBeDisabled();
    expect(more).toHaveFocus();
    const group = screen.getByRole("group", { name: "Quantity for Free entry" });
    expect(group).toHaveTextContent("4");

    // A refusal on screen survives a press on the capped "+" (nothing changed).
    fireEvent.change(screen.getByLabelText("Email for your tickets"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get free tickets" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Those tickets just ran out.");
    fireEvent.click(more);
    expect(group).toHaveTextContent("4");
    expect(screen.getByRole("alert")).toHaveTextContent("Those tickets just ran out.");
    fireEvent.click(fewer);
    expect(group).toHaveTextContent("3");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("states the free-ticket limit before the tickets", () => {
    render(<TicketSelector event={freeEvent()} />);
    const limit = screen.getByText("Up to 4 free tickets per booking, in total across the free ticket types.");
    // Read before the tickets (said to screen readers; shown only once the limit is reached).
    const firstTicket = screen.getByRole("group", { name: "Quantity for Free entry" }).closest("li");
    if (!firstTicket) throw new Error("ticket row not rendered");
    expect(limit.compareDocumentPosition(firstTicket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("applies the same free-ticket cap when paid tickets are in the booking too", () => {
    render(<TicketSelector event={mixedEvent()} />);
    const morePaid = screen.getByRole("button", { name: "Increase quantity for Supporter" });
    const moreA = screen.getByRole("button", { name: "Increase quantity for Free entry" });
    const moreB = screen.getByRole("button", { name: "Increase quantity for Kids" });
    // The paid type isn't limited by the free cap, and isn't described by it: only by its own limit.
    expect(morePaid).toHaveAccessibleDescription("Up to 8 per booking.");
    for (let i = 0; i < 6; i++) fireEvent.click(morePaid);
    fireEvent.click(moreA);
    fireEvent.click(moreA);
    fireEvent.click(moreB);
    fireEvent.click(moreB);
    expect(moreA).toHaveAttribute("aria-disabled", "true");
    expect(moreB).toHaveAttribute("aria-disabled", "true");
    expect(morePaid).toHaveAttribute("aria-disabled", "false");
    // Checkout (a paid order) still shows the free-ticket limit.
    expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    expect(screen.getByText(/That's the most free tickets one booking can have/)).toBeInTheDocument();
  });

  it("shows no free-ticket limit for an event without free tickets", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.queryByText(/free tickets per booking/)).toBeNull();
  });

  it("explains how free tickets are issued, without promising they're instant", () => {
    render(<TicketSelector event={freeEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    expect(screen.getByText(/We'll email you a link to confirm your tickets before they're issued/)).toBeInTheDocument();
    expect(screen.getByText(/your account's verified email\? That step is usually skipped/)).toBeInTheDocument();
    expect(screen.queryByText(/issued straight away|issued immediately/)).toBeNull();
  });

  it("says the server's reason in full when a booking has too many free tickets", async () => {
    createCheckoutSession.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { lineItems: "You can book up to 4 free tickets at a time." }),
    );
    render(<TicketSelector event={mixedEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Supporter" }));
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("You can book up to 4 free tickets at a time.");
    expect(alert).not.toHaveTextContent("highlighted");
    // Changing the selection clears the stale refusal.
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity for Free entry" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("puts an email refusal on the email field", async () => {
    createCheckoutSession.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { buyerEmail: "That email can't receive tickets." }),
    );
    render(<TicketSelector event={freeEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    const email = screen.getByLabelText("Email for your tickets");
    fireEvent.change(email, { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get free tickets" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email can't receive tickets.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("after a guest booking, says to check the inbox (focused, announced) and can start over", async () => {
    createCheckoutSession.mockResolvedValue({ status: "confirmation_sent", expiresInHours: 24 });
    render(<TicketSelector event={freeEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    fireEvent.change(screen.getByLabelText("Email for your tickets"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get free tickets" }));

    const heading = await screen.findByRole("heading", { name: "Check your inbox" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.getAllByRole("status").find((s) => s.textContent?.startsWith("We’ve emailed a link to fan@example.com.")),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Get free tickets" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByRole("button", { name: "Get free tickets" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Check your inbox" })).toBeNull();
    // The button is gone: focus goes to the email field, ready to change it.
    const email = screen.getByLabelText("Email for your tickets");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveValue("fan@example.com");
  });

  it("shows the server's reason when a free booking is refused", async () => {
    createCheckoutSession.mockRejectedValue(new ApiError(409, "This email address already has them."));
    render(<TicketSelector event={freeEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    fireEvent.change(screen.getByLabelText("Email for your tickets"), { target: { value: "fan@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Get free tickets" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This email address already has them.");
  });
});

describe("TicketSelector (tracking-link attribution)", () => {
  it("sends the tracking code remembered for this event, and only this event's", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    const event = live("neon-static");
    setTrackingRef(event.id, "abcd2345");
    setTrackingRef("some-other-event", "zzzz9999");
    render(<TicketSelector event={event} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).toHaveBeenCalledWith(event.id, expect.any(Array), undefined, "abcd2345", undefined, undefined);
  });
});

describe("TicketSelector (demo)", () => {
  it("keeps checkout disabled and explains why", () => {
    render(<TicketSelector event={findEvent("neon-static")} />);
    const button = screen.getByRole("button", { name: "Checkout unavailable in this demo" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});

describe("TicketSelector pricing (ACCC all-inclusive, brand-direction-one.md §6.8)", () => {
  it("shows each paid tier's all-inclusive total as the big price, with no per-ticket breakdown, before anything is chosen", () => {
    render(<TicketSelector event={live("neon-static")} />);
    const total = screen.getByText("A$32.30 incl. booking fee");
    // Owner (28 Oct 2026, less helper text): the price alone; the fee is explained once, by Checkout.
    expect(screen.queryByText(/ticket \+ A\$/)).toBeNull();
    expect(screen.getByRole("group", { name: "Quantity for General admission" })).toHaveTextContent("0");
    expect(total).toHaveClass("text-xl", "font-bold", "tabular-nums");
    expect(total.className).not.toMatch(/\blg:/);
  });

  it("an organiser-absorbed fee reads as the plain total, with no breakdown; a free tier says Free", () => {
    const base = live("neon-static");
    const event: SheltuhEvent = {
      ...base,
      ticketTypes: [
        { id: "abs", name: "Workshop", priceCents: 12000, feePolicy: "organiser-absorbs", quantityAvailable: 10 },
        { id: "free", name: "Listener", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 },
      ],
    };
    render(<TicketSelector event={event} />);
    expect(screen.getByText("A$120 incl. booking fee")).toBeInTheDocument();
    expect(screen.queryByText(/booking fee included by organiser/)).toBeNull();
    const freeRow = screen.getByRole("group", { name: "Quantity for Listener" }).closest("li");
    if (!freeRow) throw new Error("free row not rendered");
    expect(within(freeRow).getByText("Free")).toBeInTheDocument();
  });

  it("makes the order total the largest number, below a black rule, and keeps checkout black", () => {
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const totalTerm = screen.getByText("Total");
    const totalValue = totalTerm.nextElementSibling;
    expect(totalValue).toHaveTextContent("A$32.30");
    expect(totalValue).toHaveClass("text-xl", "font-bold");
    expect(totalTerm.parentElement).toHaveClass("border-t", "border-foreground");
    expect(screen.getByText("Tickets").nextElementSibling).toHaveTextContent("A$30");
    expect(screen.getByText("Booking fees").nextElementSibling).toHaveTextContent("A$2.30");
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(checkout).toHaveClass("btn-solid", "btn-lg");
    expect(checkout.className).not.toMatch(/signal|lg:/);
  });

  it("has no step indicator, paid or free", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.queryByRole("list", { name: "How booking works" })).toBeNull();
    expect(screen.queryByText(/Tickets by email/)).toBeNull();
    cleanup();
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    expect(screen.queryByRole("list", { name: "How booking works" })).toBeNull();
    expect(screen.queryByText(/Step 2 is usually skipped/)).toBeNull();
  });
});

describe("TicketSelector checkout focus and errors (WCAG 2.2)", () => {
  it("back from the payment page (restored from the back/forward cache), Checkout works again", async () => {
    // Navigating away: the request has answered and the page has gone, so nothing resets the button.
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const checkout = screen.getByRole("button", { name: "Checkout" });
    fireEvent.click(checkout);
    expect(checkout).toHaveTextContent("Opening checkout…");
    // A fresh load isn't a restore: nothing to reset.
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
    });
    expect(checkout).toHaveTextContent("Opening checkout…");
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    expect(checkout).toHaveTextContent("Checkout");
    expect(checkout).not.toHaveAttribute("aria-disabled", "true");
    expect(checkout).toBeEnabled();
  });

  it("keeps focus on Checkout while it works and after a failed checkout (busy, not disabled)", async () => {
    let reject: (err: unknown) => void = () => {};
    createCheckoutSession.mockReturnValue(new Promise((_, r) => (reject = r)));
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const checkout = screen.getByRole("button", { name: "Checkout" });
    checkout.focus();
    fireEvent.click(checkout);
    expect(checkout).toHaveTextContent("Opening checkout…");
    expect(checkout).toHaveAttribute("aria-disabled", "true");
    expect(checkout).not.toBeDisabled();
    expect(checkout).toHaveFocus();
    // A second press while busy does nothing.
    fireEvent.click(checkout);
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);

    await act(async () => reject(new ApiError(409, "Those tickets just sold out.")));
    expect(screen.getByRole("alert")).toHaveTextContent("Those tickets just sold out.");
    expect(checkout).toHaveTextContent("Checkout");
    expect(checkout).not.toHaveAttribute("aria-disabled", "true");
    expect(checkout).toHaveFocus();
  });

  it("moves focus to the email field for our own email error, every time it's shown", async () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    const email = screen.getByLabelText("Email for your tickets");
    const book = screen.getByRole("button", { name: "Get free tickets" });
    book.focus();
    fireEvent.click(book);
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAccessibleDescription(/Enter the email address to send your tickets to\.$/);
    // The same error again still brings focus back.
    book.focus();
    fireEvent.click(book);
    await waitFor(() => expect(email).toHaveFocus());
  });

  it("moves focus to the email field when the API refuses the email", async () => {
    createCheckoutSession.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { buyerEmail: "That email address doesn’t look right." }),
    );
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    const email = screen.getByLabelText("Email for your tickets");
    fireEvent.change(email, { target: { value: "fan@example.con" } });
    const book = screen.getByRole("button", { name: "Get free tickets" });
    book.focus();
    fireEvent.click(book);
    expect(await screen.findByRole("alert")).toHaveTextContent("That email address doesn’t look right.");
    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveAttribute("aria-invalid", "true");
  });
});

describe("TicketSelector announcements (one status for the panel)", () => {
  function status(): HTMLElement {
    const region = screen.getAllByRole("status").find((s) => s.classList.contains("sr-only"));
    if (!region) throw new Error("panel status not rendered");
    return region;
  }

  /** A paid type of 3, so its limit is the capacity, not 8. */
  function smallEvent(): SheltuhEvent {
    const base = live("neon-static");
    return {
      ...base,
      ticketTypes: [{ id: "few", name: "Balcony", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 3 }],
    };
  }

  it("has no live region per row, and says each change with the new total", () => {
    const { container } = render(<TicketSelector event={live("neon-static")} />);
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(0);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status()).toHaveTextContent(/^$/);
    const more = screen.getByRole("button", { name: "Increase quantity for General admission" });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(status()).toHaveTextContent("General admission: 2. Total A$64.60 incl. booking fees.");
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity for General admission" }));
    expect(status()).toHaveTextContent("General admission: 1. Total A$32.30 incl. booking fees.");
  });

  it("says why at a limit, on reaching it and on each press beyond it", () => {
    render(<TicketSelector event={smallEvent()} />);
    const more = screen.getByRole("button", { name: "Increase quantity for Balcony" });
    // A static hint, before the limit is reached, on the + button.
    expect(more).toHaveAccessibleDescription("Up to 3 per booking.");
    // For screen readers only: the + goes aria-disabled at the limit.
    expect(screen.getByText("Up to 3 per booking.")).toHaveClass("sr-only");
    for (let i = 0; i < 3; i++) fireEvent.click(more);
    expect(status()).toHaveTextContent("Balcony: 3. Total A$96.90 incl. booking fees. Up to 3 per booking.");
    fireEvent.click(more);
    expect(status().textContent?.trim()).toBe("Balcony: 3. Up to 3 per booking.");
    const first = status().textContent;
    fireEvent.click(more);
    // Same words, new text, so it's read again.
    expect(status().textContent).not.toBe(first);
    expect(status().textContent?.trim()).toBe("Balcony: 3. Up to 3 per booking.");
  });

  it("names the free-ticket limit when that's the one reached", () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    const more = screen.getByRole("button", { name: "Increase quantity for Free entry" });
    for (let i = 0; i < 4; i++) fireEvent.click(more);
    expect(status()).toHaveTextContent("Free entry: 4. Total A$0. Up to 4 free tickets per booking.");
  });

  it("says nothing before anything changes, and nothing for a press on − at 0", () => {
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity for General admission" }));
    expect(status().textContent).toBe("");
  });
});

describe("TicketSelector before anything is chosen", () => {
  it("a paid event says Checkout and to choose tickets, never 'Get free tickets' or 'No payment step'", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Get free tickets" })).toBeNull();
    // Not visible copy: the disabled button's accessible description says it.
    expect(screen.getByRole("button", { name: "Checkout" })).toHaveAccessibleDescription("Choose tickets to continue.");
    expect(screen.getByText("Choose tickets to continue.")).toHaveClass("sr-only");
    expect(screen.queryByText(/No payment step/)).toBeNull();
    // Once chosen, the copy follows the total.
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    expect(
      screen.getByText("You'll pay on the next page, in a secure form from Stripe, our payment provider."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Stripe's own checkout page/)).toBeNull();
    expect(screen.queryByText("Choose tickets to continue.")).toBeNull();
  });

  it("an all-free event says Get free tickets", () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    const button = screen.getByRole("button", { name: "Get free tickets" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Choose tickets to continue.");
  });

  it("a mixed event with only a free ticket chosen is a free booking", () => {
    const base = live("neon-static");
    const event: SheltuhEvent = {
      ...base,
      ticketTypes: [
        ...base.ticketTypes,
        { id: "free", name: "Listener", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 },
      ],
    };
    render(<TicketSelector event={event} />);
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Listener" }));
    expect(screen.getByRole("button", { name: "Get free tickets" })).toBeEnabled();
    expect(screen.getByText(/No payment step/)).toBeInTheDocument();
  });
});

describe("TicketSelector terms and privacy", () => {
  function expectTermsLinks() {
    const terms = screen.getByRole("link", { name: "Purchase Terms" });
    const privacy = screen.getByRole("link", { name: "Privacy Policy" });
    expect(terms).toHaveAttribute("href", "/purchase-terms");
    expect(privacy).toHaveAttribute("href", "/privacy");
    for (const link of [terms, privacy]) expect(link).toHaveClass("text-foreground", "underline");
    expect(terms.closest("p")).toHaveTextContent("By booking you agree to the Purchase Terms. See our Privacy Policy.");
  }

  it("says what booking agrees to, under Checkout", () => {
    render(<TicketSelector event={live("neon-static")} />);
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expectTermsLinks();
    expect(
      checkout.compareDocumentPosition(screen.getByRole("link", { name: "Purchase Terms" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("and with the email field of a free booking", () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    expect(screen.getByLabelText("Email for your tickets")).toBeInTheDocument();
    expectTermsLinks();
  });

  it("isn't shown in the demo, where nothing can be booked", () => {
    render(<TicketSelector event={findEvent("neon-static")} />);
    expect(screen.queryByRole("link", { name: "Purchase Terms" })).toBeNull();
  });
});

describe("TicketSelector booking fee note", () => {
  const NOTE = describeBookingFeeNote();

  it("is said once, near Checkout, from lib/fees.ts, and the long rule above the tickets is gone", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
    expect(NOTE).toBe("Prices include a booking fee of 6% of ticket face value + A$0.50 per paid ticket.");
    expect(screen.queryByText(/^Booking fee: /)).toBeNull();
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(checkout.compareDocumentPosition(screen.getByText(NOTE)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("isn't shown when the organiser absorbs every fee", () => {
    const base = live("neon-static");
    render(
      <TicketSelector
        event={{
          ...base,
          ticketTypes: base.ticketTypes.map((t) => ({ ...t, feePolicy: "organiser-absorbs" as const })),
        }}
      />,
    );
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("isn't shown for a free-only event", () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    expect(screen.queryByText(NOTE)).toBeNull();
  });
});

describe("TicketSelector never sells a seated tier (reserved seating)", () => {
  it("leaves seated tiers out, so only general admission can be chosen and checked out", async () => {
    const base = live("neon-static");
    const [ga, vip] = base.ticketTypes;
    const event: SheltuhEvent = { ...base, seating: { version: 1 }, ticketTypes: [ga, { ...vip, seated: true }] };
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={event} />);
    expect(screen.queryByText(vip.name)).toBeNull();
    expect(screen.queryByRole("button", { name: `Increase quantity for ${vip.name}` })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: `Increase quantity for ${ga.name}` }));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(createCheckoutSession.mock.calls[0][1]).toEqual([{ ticketTypeId: ga.id, quantity: 1 }]);
  });
});

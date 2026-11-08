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
import { typeName } from "./test-utils/buyerName";
import { priceLine, selectCard } from "./test-utils/ticketCards";

// Live mode: checkout is only offered when the API is configured.
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const track = vi.fn();
const rememberCheckoutStarted = vi.fn();
vi.mock("@/lib/analytics", () => ({
  track: (...args: unknown[]) => track(...args),
  rememberCheckoutStarted: (...args: unknown[]) => rememberCheckoutStarted(...args),
}));
const createCheckoutSession = vi.fn();
vi.mock("@/lib/api/orders", () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));

afterEach(() => {
  cleanup();
  track.mockReset();
  rememberCheckoutStarted.mockReset();
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

  it("keeps its Checkout on every screen when there is no phone buy bar around it", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getByRole("button", { name: "Checkout" }).className).not.toMatch(/hidden/);
  });

  it("Checkout is described by the total, as the bar's button is, and says Total when nothing's chosen only via its hint", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getByRole("button", { name: "Checkout" })).toHaveAccessibleDescription("Choose tickets to continue.");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    expect(screen.getByRole("button", { name: "Checkout" })).toHaveAccessibleDescription("Total A$32.30");
  });

  it("says what the Tickets line is made of for one tier: quantity × face price", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.queryByText(/×/)).toBeNull();
    const more = screen.getByRole("button", { name: "Increase quantity for General admission" });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByText("Tickets").closest("dt")).toHaveTextContent("Tickets (2 × A$30.00)");
    expect(screen.getByText("Tickets").nextElementSibling).toHaveTextContent("A$60.00");
  });

  it("shows each ticket's all-inclusive price", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getByText(priceLine("A$32.30 incl. booking fee"))).toBeInTheDocument();
    expect(screen.getByText(priceLine("A$55 incl. booking fee"))).toBeInTheDocument();
  });

  it("free orders ask for an email (16px, 48px field) and announce a bad one", () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    const email = screen.getByLabelText("Email for your tickets");
    expect(email).toHaveClass("min-h-12", "text-base");
    fireEvent.change(email, { target: { value: "not-an-email" } });
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the email address to send your tickets to.");
    expect(email).toHaveAttribute("aria-invalid", "true");
    // Both the hint and the error describe the field.
    expect(email).toHaveAccessibleDescription(
      "Tickets are sent here. Use your account email to join Who’s Going. Enter the email address to send your tickets to.",
    );
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });
});

describe("TicketSelector: usage analytics", () => {
  it("checkout_started is sent once, with counts and flags only, when a free booking is accepted", async () => {
    createCheckoutSession.mockResolvedValue({ status: "confirmation_sent", expiresInHours: 24 });
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    const more = screen.getByRole("button", { name: "Increase quantity for Free entry" });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.change(screen.getByLabelText("Email for your tickets"), { target: { value: "fan@example.com" } });
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
    await screen.findByRole("heading", { name: "Check your inbox" });
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("checkout_started", {
      event_slug: "brunswick-zine-fair",
      ticket_count: 2,
      has_support: false,
      free: true,
    });
    expect(JSON.stringify(track.mock.calls)).not.toContain("fan@example.com");
    // No payment page was opened: nothing to remember for the success page.
    expect(rememberCheckoutStarted).not.toHaveBeenCalled();
  });

  it("a paid checkout is noted for the success page, with the order it leads to", async () => {
    const result = { url: "https://checkout.sheltuh.test/checkout/pay?order=ord_1", orderId: "ord_1" };
    createCheckoutSession.mockResolvedValue(result);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(track).toHaveBeenCalledTimes(1));
    expect(track).toHaveBeenCalledWith("checkout_started", expect.objectContaining({ event_slug: "neon-static", ticket_count: 1, free: false }));
    expect(rememberCheckoutStarted).toHaveBeenCalledWith(result);
    quiet.mockRestore();
  });

  it("nothing is sent when checkout is refused", async () => {
    createCheckoutSession.mockRejectedValue(new ApiError(409, "Those tickets just ran out."));
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    fireEvent.change(screen.getByLabelText("Email for your tickets"), { target: { value: "fan@example.com" } });
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
    await screen.findByRole("alert");
    expect(track).not.toHaveBeenCalled();
    expect(rememberCheckoutStarted).not.toHaveBeenCalled();
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
      "Tickets are sent here. Use your account email to join Who’s Going.",
    );
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
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
      "Alex Doe",
    );
  });

  it("offers a way out of the account for a paid order: Not you? Sign out (this browser only), said and with focus on the name", () => {
    const value = fakeAuthValue({ email: "mia@example.com" });
    render(
      <FakeAuthProvider value={value}>
        <TicketSelector event={live("neon-static")} />
      </FakeAuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const out = screen.getByRole("button", { name: "Not you? Sign out and book as a guest" });
    expect(out).toHaveClass("min-h-11");
    fireEvent.click(out);
    expect(value.signOut).toHaveBeenCalledWith("local");
    // The panel's one status says what happens next, and focus lands on the name field (not lost with the button).
    const status = screen.getAllByRole("status").find((el) => el.classList.contains("sr-only"));
    expect(status).toHaveTextContent("Signed out. Stripe will ask for your email.");
    expect(screen.getByLabelText("Your name")).toHaveFocus();
  });

  it("lets the buyer replace the prefilled email, including clearing it", () => {
    renderSignedIn("brunswick-zine-fair");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    const email = screen.getByLabelText("Email for your tickets");
    fireEvent.change(email, { target: { value: "" } });
    expect(email).toHaveValue("");
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter the email address to send your tickets to.");
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("books paid tickets with the account email, and says so before Checkout", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    renderSignedIn("neon-static");
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const hint = screen.getByText((_c, el) => el?.tagName === "P" && el.textContent?.startsWith("Booking as mia@example.com") === true);
    expect(within(hint).getByText("mia@example.com")).toHaveClass("underline");
    const checkout = screen.getByRole("button", { name: "Checkout" });
    // The hint is read before the button, not after it.
    expect(hint.compareDocumentPosition(checkout) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    typeName();
    fireEvent.click(checkout);
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.any(String),
      [{ ticketTypeId: expect.any(String), quantity: 1 }],
      "mia@example.com",
      undefined,
      undefined,
      // Nothing pre-selected: no Support Sheltüh unless the buyer picks some.
      undefined,
      "Alex Doe",
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
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.any(String), expect.any(Array), undefined, undefined, undefined, undefined, "Alex Doe");
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
    // One stepper, for the selected release (the first on sale to begin with).
    const more = () => screen.getByRole("button", { name: /^Increase quantity for / });
    expect(more()).toHaveAccessibleName("Increase quantity for Free entry");
    expect(more()).toHaveAccessibleDescription("Up to 4 free tickets per booking.");
    for (let i = 0; i < 3; i++) fireEvent.click(more());
    expect(more()).toHaveAttribute("aria-disabled", "false");
    selectCard("Kids");
    expect(more()).toHaveAccessibleName("Increase quantity for Kids");
    expect(more()).toHaveAttribute("aria-disabled", "true");
    expect(more()).toHaveAccessibleDescription("Up to 4 free tickets per booking.");
    selectCard("Free entry");
    expect(more()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity for Free entry" }));
    expect(more()).toHaveAttribute("aria-disabled", "false");
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
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
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
    const limit = screen.getByText("Up to 4 free tickets per booking.");
    // Read before the tickets (said to screen readers; shown only once the limit is reached).
    const firstTicket = screen.getByText("Free entry").closest("li");
    if (!firstTicket) throw new Error("ticket row not rendered");
    expect(limit.compareDocumentPosition(firstTicket) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("applies the same free-ticket cap when paid tickets are in the booking too", () => {
    render(<TicketSelector event={mixedEvent()} />);
    const more = () => screen.getByRole("button", { name: /^Increase quantity for / });
    // The paid type isn't limited by the free cap, and isn't described by it: only by its own limit.
    expect(more()).toHaveAccessibleName("Increase quantity for Supporter");
    expect(more()).toHaveAccessibleDescription("Up to 8 per booking.");
    for (let i = 0; i < 6; i++) fireEvent.click(more());
    // Pressing a free card adds its first ticket; one more press makes two of each free type.
    selectCard("Free entry");
    fireEvent.click(more());
    selectCard("Kids");
    fireEvent.click(more());
    expect(more()).toHaveAccessibleName("Increase quantity for Kids");
    expect(more()).toHaveAttribute("aria-disabled", "true");
    selectCard("Free entry");
    expect(more()).toHaveAttribute("aria-disabled", "true");
    selectCard("Supporter");
    expect(more()).toHaveAccessibleName("Increase quantity for Supporter");
    expect(more()).toHaveAttribute("aria-disabled", "false");
    // Checkout (a paid order) still shows the free-ticket limit.
    expect(screen.getByRole("button", { name: "Checkout" })).toBeEnabled();
    expect(screen.getAllByText(/Up to 4 free tickets per booking/)[0]).toBeInTheDocument();
  });

  it("shows no free-ticket limit for an event without free tickets", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.queryByText(/free tickets per booking/)).toBeNull();
  });

  it("explains how free tickets are issued, without promising they're instant", () => {
    render(<TicketSelector event={freeEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    expect(screen.getByText(/We’ll email a link to confirm your tickets/)).toBeInTheDocument();
    expect(screen.queryByText(/issued straight away|issued immediately/)).toBeNull();
  });

  it("says the server's reason in full when a booking has too many free tickets", async () => {
    createCheckoutSession.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { lineItems: "You can book up to 4 free tickets at a time." }),
    );
    render(<TicketSelector event={mixedEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Supporter" }));
    selectCard("Free entry");
    typeName();
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
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That email can't receive tickets.");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(email).toHaveAttribute("aria-invalid", "true");
  });

  it("after a guest booking, says to check the inbox (focused, announced) and can start over", async () => {
    createCheckoutSession.mockResolvedValue({ status: "confirmation_sent", expiresInHours: 24 });
    render(<TicketSelector event={freeEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Free entry" }));
    fireEvent.change(screen.getByLabelText("Email for your tickets"), { target: { value: "fan@example.com" } });
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));

    const heading = await screen.findByRole("heading", { name: "Check your inbox" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(
      screen.getAllByRole("status").find((s) => s.textContent?.startsWith("Link sent to fan@example.com.")),
    ).toBeDefined();
    expect(screen.queryByRole("button", { name: "Free tickets" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByRole("button", { name: "Free tickets" })).toBeEnabled();
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
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
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
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).toHaveBeenCalledWith(event.id, expect.any(Array), undefined, "abcd2345", undefined, undefined, "Alex Doe");
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
    const total = screen.getByText(priceLine("A$32.30 incl. booking fee"));
    // Owner (28 Oct 2026, less helper text): the price alone; the fee is explained once, by Checkout.
    expect(screen.queryByText(/ticket \+ A\$/)).toBeNull();
    expect(screen.getByRole("group", { name: "Quantity for General admission" })).toHaveTextContent("0");
    // Compact on phones, larger from sm; the amount is bold and "incl. booking fee" lighter (the owner's mockup).
    expect(total).toHaveClass("text-base", "sm:text-xl", "tabular-nums");
    expect(within(total).getByText("A$32.30")).toHaveClass("font-bold");
    expect(within(total).getByText("incl. booking fee")).toHaveClass("font-medium");
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
    expect(screen.getByText(priceLine("A$120 incl. booking fee"))).toBeInTheDocument();
    expect(screen.queryByText(/booking fee included by organiser/)).toBeNull();
    const freeRow = screen.getByText("Listener").closest("li");
    if (!freeRow) throw new Error("free row not rendered");
    expect(within(freeRow).getByText("Free")).toBeInTheDocument();
  });

  it("makes the order total the largest number, in a peach box, with two-decimal figures, and Checkout orange with a lock", () => {
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const totalTerm = screen.getByText("Total");
    const totalValue = totalTerm.nextElementSibling;
    expect(totalValue).toHaveTextContent("A$32.30");
    expect(totalValue).toHaveClass("text-2xl", "font-bold");
    expect(totalTerm.parentElement).toHaveClass("bg-tint", "rounded-card");
    expect(screen.getByText("Tickets").nextElementSibling).toHaveTextContent("A$30.00");
    expect(screen.getByText("Booking fees").nextElementSibling).toHaveTextContent("A$2.30");
    const checkout = screen.getByRole("button", { name: "Checkout" });
    // The owner's mockup (6 Nov 2026): orange, 12px, large label, a lock; no phone class means it shows at every width here.
    expect(checkout).toHaveClass("btn-signal", "btn-lg", "rounded-card", "text-xl");
    expect(checkout.querySelector("svg")).not.toBeNull();
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
    typeName();
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

  it("a second press in the same tick (before the busy state has rendered) starts no second order", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    typeName();
    const checkout = screen.getByRole("button", { name: "Checkout" });
    // Two native clicks inside one act: React hasn't re-rendered between them, so the button isn't busy yet.
    act(() => {
      checkout.click();
      checkout.click();
    });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("back from the payment page (bfcache), the guard is reset too: Checkout starts a new order again", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    // Still the same checkout: nothing more starts.
    fireEvent.click(screen.getByRole("button", { name: /Opening checkout/ }));
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).toHaveBeenCalledTimes(2);
  });

  it("keeps focus on Checkout while it works and after a failed checkout (busy, not disabled)", async () => {
    let reject: (err: unknown) => void = () => {};
    createCheckoutSession.mockReturnValue(new Promise((_, r) => (reject = r)));
    render(<TicketSelector event={live("neon-static")} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const checkout = screen.getByRole("button", { name: "Checkout" });
    checkout.focus();
    typeName();
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
    const book = screen.getByRole("button", { name: "Free tickets" });
    typeName();
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
    const book = screen.getByRole("button", { name: "Free tickets" });
    typeName();
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
  it("a paid event says Checkout and to choose tickets, never 'Free tickets' or 'No payment step'", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getByRole("button", { name: "Checkout" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Free tickets" })).toBeNull();
    // Not visible copy: the disabled button's accessible description says it.
    expect(screen.getByRole("button", { name: "Checkout" })).toHaveAccessibleDescription("Choose tickets to continue.");
    expect(screen.getByText("Choose tickets to continue.")).toHaveClass("sr-only");
    expect(screen.queryByText(/No payment step/)).toBeNull();
    // Once chosen, the copy follows the total.
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    expect(
      screen.getByText("You’ll pay on the next page, via Stripe."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Stripe's own checkout page/)).toBeNull();
    expect(screen.queryByText("Choose tickets to continue.")).toBeNull();
  });

  it("an all-free event says Free tickets", () => {
    render(<TicketSelector event={live("brunswick-zine-fair")} />);
    const button = screen.getByRole("button", { name: "Free tickets" });
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
    selectCard("Listener");
    expect(screen.getByRole("button", { name: "Free tickets" })).toBeEnabled();
    expect(screen.getByText(/We’ll email a link to confirm your tickets/)).toBeInTheDocument();
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

  it("is said once, under Checkout with an (i) mark, from lib/fees.ts, and the long rule above the tickets is gone", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getAllByText(NOTE)).toHaveLength(1);
    expect(NOTE).toBe("Prices include a booking fee of 6% of ticket face value + A$0.50 per paid ticket.");
    expect(screen.queryByText(/^Booking fee: /, { selector: "dd" })).toBeNull();
    const checkout = screen.getByRole("button", { name: "Checkout" });
    const note = screen.getByText(NOTE);
    expect(checkout.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.closest("p")?.querySelector("svg")).not.toBeNull();
  });

  it("the Booking fees (i) closes with Escape and when focus leaves it", () => {
    render(<TicketSelector event={live("neon-static")} />);
    const info = screen.getByRole("button", { name: "About the booking fee" });
    info.focus();
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(info, { key: "Escape" });
    expect(info).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");
    act(() => info.blur());
    expect(info).toHaveAttribute("aria-expanded", "false");
  });

  it("the Booking fees (i) is a keyboard toggletip: it says what the fee is, under the row and in the panel's status", () => {
    render(<TicketSelector event={live("neon-static")} />);
    const info = screen.getByRole("button", { name: "About the booking fee" });
    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/^Booking fee: /, { selector: "dd" })).toBeNull();
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "true");
    const text = "Booking fee: 6% of ticket face value + A$0.50 per paid ticket.";
    expect(screen.getByText(text, { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(text);
    // The 44px target doesn't make the row taller.
    expect(info).toHaveClass("size-11", "-my-3");
    fireEvent.click(info);
    expect(info).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/^Booking fee: /, { selector: "dd" })).toBeNull();
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
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() => expect(createCheckoutSession).toHaveBeenCalledTimes(1));
    expect(createCheckoutSession.mock.calls[0][1]).toEqual([{ ticketTypeId: ga.id, quantity: 1 }]);
  });
});

describe("TicketSelector: sequential release (a tier waiting for the one above)", () => {
  const cinder = () => live("cinder-warehouse-sessions");

  it("a waiting tier is muted, has no stepper, and says what it waits for", () => {
    render(<TicketSelector event={cinder()} />);
    const second = screen.getByText("Second release").closest("li") as HTMLElement;
    expect(within(second).getByText("Opens after First release")).toBeInTheDocument();
    expect(within(second).queryByRole("button")).toBeNull();
    expect(within(second).queryByRole("group")).toBeNull();
    expect(within(second).getByText("Second release")).toHaveClass("text-muted");
    expect(within(second).getByText(priceLine("A$37.60 incl. booking fee"))).toHaveClass("text-muted");
    const final = screen.getByText("Final release").closest("li") as HTMLElement;
    expect(within(final).getByText("Opens after Second release")).toBeInTheDocument();
    expect(within(final).queryByRole("button")).toBeNull();
    // The first tier is the only one that can be chosen.
    expect(screen.getAllByRole("button", { name: /Increase quantity/ })).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Increase quantity for First release" })).toBeInTheDocument();
  });

  it("once the tier above sells out, the tier is bought as any other", () => {
    const event = cinder();
    render(
      <TicketSelector
        event={{
          ...event,
          ticketTypes: event.ticketTypes.map((t, i) =>
            i === 0 ? { ...t, soldOut: true } : i === 1 ? { ...t, opensAfter: undefined } : t,
          ),
        }}
      />,
    );
    expect(screen.queryByText("Opens after First release")).toBeNull();
    expect(screen.getByRole("button", { name: "Increase quantity for Second release" })).toBeInTheDocument();
    expect(screen.getByText("Opens after Second release")).toBeInTheDocument();
  });

  it("a tier that sold out before it was set to wait says Sold out, not Opens when", () => {
    const event = cinder();
    render(<TicketSelector event={{ ...event, ticketTypes: event.ticketTypes.map((t, i) => (i === 1 ? { ...t, soldOut: true } : t)) }} />);
    const second = screen.getByText("Second release").closest("li") as HTMLElement;
    expect(within(second).queryByText("Opens after First release")).toBeNull();
    expect(within(second).getByText(/Sold out/)).toBeInTheDocument();
    expect(within(second).queryByRole("button")).toBeNull();
  });

  it("shows the server's ticket_locked refusal", async () => {
    createCheckoutSession.mockRejectedValue(
      new ApiError(409, "\"Second release\" opens after \"First release\" sells out.", undefined, { code: "ticket_locked" }),
    );
    render(<TicketSelector event={cinder()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for First release" }));
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("\"Second release\" opens after \"First release\" sells out."),
    );
  });
});

describe("TicketSelector: group tickets", () => {
  /** Singles at A$35 and a "Group of 4" at A$120, both buyer-pays: the owner's example (A$37.60 x 4 = A$150.40 against A$127.70). */
  function groupEvent(overrides: Partial<SheltuhEvent["ticketTypes"][number]> = {}): SheltuhEvent {
    const base = live("neon-static");
    return {
      ...base,
      ticketTypes: [
        { id: "single", name: "Single", priceCents: 3500, feePolicy: "buyer-pays", quantityAvailable: 50 },
        { id: "group", name: "Group of 4", priceCents: 12000, feePolicy: "buyer-pays", quantityAvailable: 40, admits: 4, ...overrides },
      ],
    };
  }

  it("says what a group gets and what it saves, against the same number of singles", () => {
    render(<TicketSelector event={groupEvent()} />);
    const row = screen.getByText("Group of 4").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("4 tickets · save A$22.70");
    // The headline is the group's all-inclusive price.
    expect(within(row).getByText(priceLine("A$127.70 for 4 incl. booking fee"))).toBeInTheDocument();
    // A single says neither.
    const single = screen.getByText("Single").closest("li") as HTMLElement;
    expect(single).not.toHaveTextContent("tickets");
    expect(single).not.toHaveTextContent("save");
  });

  it("shows no saving when the group isn't cheaper, or there is no single to compare with", () => {
    const { unmount } = render(<TicketSelector event={groupEvent({ priceCents: 15000 })} />);
    const row = screen.getByText("Group of 4").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("4 tickets");
    expect(screen.queryByText(/save/)).toBeNull();
    unmount();

    const only = groupEvent();
    render(<TicketSelector event={{ ...only, ticketTypes: [only.ticketTypes[1]] }} />);
    expect(screen.getByText("4 tickets")).toBeInTheDocument();
    expect(screen.queryByText(/save/)).toBeNull();
  });

  it("counts in groups: the stepper is groups, announced with the tickets, and checkout sends groups", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    render(<TicketSelector event={groupEvent()} />);
    // Pressing the group's card selects it with its first group; one more press makes two.
    selectCard("Group of 4");
    const more = screen.getByRole("button", { name: "Increase quantity for Group of 4" });
    fireEvent.click(more);
    expect(screen.getByRole("status")).toHaveTextContent("Group of 4: 2 groups, 8 tickets. Total A$255.40");
    const stepper = screen.getByRole("group", { name: "Quantity for Group of 4" });
    expect(stepper).toHaveTextContent("2 groups");
    // The order summary counts tickets as people get them.
    expect(screen.getByText("Tickets (8)")).toBeInTheDocument();
    typeName();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.any(String),
      [{ ticketTypeId: "group", quantity: 2 }],
      undefined,
      undefined,
      undefined,
      undefined,
      "Alex Doe",
    );
  });

  it("keeps the plain 'Tickets' line while no group is chosen", () => {
    render(<TicketSelector event={groupEvent()} />);
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for Single" }));
    expect(screen.getByText("Tickets")).toBeInTheDocument();
    expect(screen.queryByText(/Tickets \(/)).toBeNull();
  });

  it("stops at 5 groups (20 people), and says so in groups", () => {
    render(<TicketSelector event={groupEvent()} />);
    selectCard("Group of 4");
    const more = screen.getByRole("button", { name: "Increase quantity for Group of 4" });
    for (let i = 0; i < 7; i++) fireEvent.click(more);
    expect(screen.getByRole("group", { name: "Quantity for Group of 4" })).toHaveTextContent("5 groups");
    expect(more).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Up to 5 per booking.");
  });

  it("counts what's left in groups: 'remaining' is people", () => {
    render(<TicketSelector event={groupEvent({ remaining: 8 })} />);
    const row = screen.getByText("Group of 4").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("Only 2 groups left.");
    selectCard("Group of 4");
    const more = screen.getByRole("button", { name: "Increase quantity for Group of 4" });
    fireEvent.click(more);
    fireEvent.click(more);
    fireEvent.click(more);
    expect(screen.getByRole("group", { name: "Quantity for Group of 4" })).toHaveTextContent("2 groups");
  });

  it("caps at the groups left when 12 people are left (more than the 10 a single shows)", () => {
    render(<TicketSelector event={groupEvent({ remaining: 12 })} />);
    const row = screen.getByText("Group of 4").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("Only 3 groups left.");
    selectCard("Group of 4");
    const more = screen.getByRole("button", { name: "Increase quantity for Group of 4" });
    for (let i = 0; i < 5; i++) fireEvent.click(more);
    expect(screen.getByRole("group", { name: "Quantity for Group of 4" })).toHaveTextContent("3 groups");
    expect(more).toHaveAttribute("aria-disabled", "true");
  });

  it("only compares with a single that has enough left", () => {
    const event = groupEvent();
    render(<TicketSelector event={{ ...event, ticketTypes: [{ ...event.ticketTypes[0], remaining: 3 }, event.ticketTypes[1]] }} />);
    expect(screen.queryByText(/save/)).toBeNull();
  });

  it("the demo's Paper Moon workshop offers a Group of 4 that saves A$20", () => {
    render(<TicketSelector event={findEvent("paper-moon-ceramics-lab")} />);
    expect(screen.getByText("Group of 4").closest("li")).toHaveTextContent("4 tickets · save A$20");
  });
});

describe("TicketSelector (buyer name)", () => {
  function chooseOne(slug = "neon-static", ticket = "General admission") {
    render(<TicketSelector event={live(slug)} />);
    fireEvent.click(screen.getByRole("button", { name: `Increase quantity for ${ticket}` }));
    return screen.getByLabelText("Your name");
  }

  it("asks for a name on a paid and a free order, with the notice as its hint", () => {
    for (const [slug, ticket] of [
      ["neon-static", "General admission"],
      ["brunswick-zine-fair", "Free entry"],
    ]) {
      const name = chooseOne(slug, ticket);
      expect(name).toHaveAttribute("autocomplete", "name");
      expect(name).toBeRequired();
      expect(name).toHaveClass("min-h-12", "text-base");
      expect(name).toHaveValue("");
      expect(name).toHaveAccessibleDescription("Your name and email are shared with the organiser of this event.");
      cleanup();
    }
  });

  it("is not prefilled from the account", () => {
    render(
      <FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>
        <TicketSelector event={live("neon-static")} />
      </FakeAuthProvider>,
    );
    expect(screen.getByLabelText("Your name")).toHaveValue("");
  });

  it("sits before the email and Checkout, and sends the trimmed name", () => {
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    const name = chooseOne("brunswick-zine-fair", "Free entry");
    const email = screen.getByLabelText("Email for your tickets");
    expect(name.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(email, { target: { value: "fan@example.com" } });
    fireEvent.change(name, { target: { value: "  Alex Doe  " } });
    fireEvent.click(screen.getByRole("button", { name: "Free tickets" }));
    expect(createCheckoutSession.mock.calls[0][2]).toBe("fan@example.com");
    expect(createCheckoutSession.mock.calls[0][6]).toBe("Alex Doe");
  });

  it("stops an empty name with an announced error and focus on the field, then clears it on typing", async () => {
    const name = chooseOne();
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your name.");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(/Enter your name\.$/);
    await waitFor(() => expect(name).toHaveFocus());
    fireEvent.change(name, { target: { value: "A" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(name).not.toHaveAttribute("aria-invalid");
  });

  it("refuses a name over 80 characters, counting characters not code units", () => {
    const name = chooseOne();
    fireEvent.change(name, { target: { value: "a".repeat(81) } });
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Use 80 characters or fewer.");
    expect(createCheckoutSession).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "😀".repeat(80) } });
    createCheckoutSession.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("puts the API's refusal of the name on the field and focuses it", async () => {
    createCheckoutSession.mockRejectedValue(
      new ApiError(400, "Please fix the highlighted fields.", { buyerName: "Use your name, not an email or a link." }),
    );
    const name = chooseOne();
    fireEvent.change(name, { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Checkout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Use your name, not an email or a link.");
    await waitFor(() => expect(name).toHaveFocus());
    expect(name).toHaveAttribute("aria-invalid", "true");
  });
});

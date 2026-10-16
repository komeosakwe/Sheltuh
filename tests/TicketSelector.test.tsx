// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TicketSelector from "@/components/TicketSelector";
import { ApiError } from "@/lib/api/client";
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
    // Nothing chosen yet: a A$0 order, so the (disabled) button reads "Get free tickets".
    expect(screen.getByRole("button", { name: "Get free tickets" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity for General admission" }));
    const checkout = screen.getByRole("button", { name: "Checkout" });
    expect(checkout).toHaveClass("btn-lg");
    expect(checkout).toBeEnabled();
  });

  it("shows each ticket's all-inclusive price", () => {
    render(<TicketSelector event={live("neon-static")} />);
    expect(screen.getByText("A$31.70 incl. booking fee")).toBeInTheDocument();
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
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.any(String), expect.any(Array), undefined, undefined, undefined);
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
    expect(moreA).toBeEnabled();
    fireEvent.click(moreB);
    expect(moreA).toBeDisabled();
    expect(moreB).toBeDisabled();
    expect(moreB).toHaveAccessibleDescription(
      "That's the most free tickets one booking can have (4 in total, across the free ticket types).",
    );
    fireEvent.click(screen.getByRole("button", { name: "Decrease quantity for Free entry" }));
    expect(moreB).toBeEnabled();
  });

  it("applies the same free-ticket cap when paid tickets are in the booking too", () => {
    render(<TicketSelector event={mixedEvent()} />);
    const morePaid = screen.getByRole("button", { name: "Increase quantity for Supporter" });
    const moreA = screen.getByRole("button", { name: "Increase quantity for Free entry" });
    const moreB = screen.getByRole("button", { name: "Increase quantity for Kids" });
    // The paid type isn't limited by the free cap, and isn't described by it.
    expect(morePaid).not.toHaveAccessibleDescription();
    for (let i = 0; i < 6; i++) fireEvent.click(morePaid);
    fireEvent.click(moreA);
    fireEvent.click(moreA);
    fireEvent.click(moreB);
    fireEvent.click(moreB);
    expect(moreA).toBeDisabled();
    expect(moreB).toBeDisabled();
    expect(morePaid).toBeEnabled();
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
    expect(screen.getByRole("status")).toHaveTextContent("We’ve emailed a link to fan@example.com.");
    expect(screen.queryByRole("button", { name: "Get free tickets" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByRole("button", { name: "Get free tickets" })).toBeEnabled();
    expect(screen.queryByRole("heading", { name: "Check your inbox" })).toBeNull();
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
    expect(createCheckoutSession).toHaveBeenCalledWith(event.id, expect.any(Array), undefined, "abcd2345", undefined);
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

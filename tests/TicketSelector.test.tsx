// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TicketSelector from "@/components/TicketSelector";
import { sampleEvents } from "@/lib/sample-events";
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
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.any(String),
      [{ ticketTypeId: expect.any(String), quantity: 1 }],
      "mia@example.com",
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
    expect(createCheckoutSession).toHaveBeenCalledWith(expect.any(String), expect.any(Array), undefined);
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

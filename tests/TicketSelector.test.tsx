// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TicketSelector from "@/components/TicketSelector";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

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

describe("TicketSelector (demo)", () => {
  it("keeps checkout disabled and explains why", () => {
    render(<TicketSelector event={findEvent("neon-static")} />);
    const button = screen.getByRole("button", { name: "Checkout unavailable in this demo" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});

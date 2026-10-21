// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TicketSelector from "@/components/TicketSelector";
import WaitlistBlock from "@/components/waitlist/WaitlistBlock";
import { ApiError } from "@/lib/api/client";
import type { SheltuhEvent } from "@/lib/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  isApiConfigured: true,
}));
const joinWaitlist = vi.fn();
const getWaitlistStatus = vi.fn();
const leaveWaitlist = vi.fn();
vi.mock("@/lib/api/waitlist", () => ({
  joinWaitlist: (...args: unknown[]) => joinWaitlist(...args),
  getWaitlistStatus: (...args: unknown[]) => getWaitlistStatus(...args),
  leaveWaitlist: (...args: unknown[]) => leaveWaitlist(...args),
}));
vi.mock("@/lib/api/orders", () => ({ createCheckoutSession: vi.fn() }));

beforeEach(() => {
  joinWaitlist.mockReset();
  getWaitlistStatus.mockReset();
  leaveWaitlist.mockReset();
});
afterEach(cleanup);

function signedIn(children: React.ReactNode) {
  return render(<FakeAuthProvider value={fakeAuthValue({ email: "mia@example.com" })}>{children}</FakeAuthProvider>);
}

const tier = (id: string, priceCents: number, extra: Partial<SheltuhEvent["ticketTypes"][number]> = {}) => ({
  id,
  name: id === "ga" ? "General admission" : "Concession",
  priceCents,
  feePolicy: "buyer-pays" as const,
  quantityAvailable: 50,
  ...extra,
});

const soldOutEvent: SheltuhEvent = {
  id: "evt-1",
  organiserId: "org-1",
  slug: "sold-out-night",
  title: "Sold Out Night",
  description: "d",
  category: "theatre",
  suburb: "St Kilda",
  venueName: "Studio",
  venueAddress: "1 St",
  startsAt: "2099-11-14T08:00:00.000Z",
  endsAt: "2099-11-14T10:00:00.000Z",
  organiserName: "Co.",
  poster: { pattern: "rings", background: "#000000", primary: "#ff4800", secondary: "#fffae7" },
  soldOut: true,
  ticketTypes: [tier("ga", 3500, { soldOut: true, remaining: 0 }), tier("conc", 2500, { soldOut: true, remaining: 0 })],
};

describe("TicketSelector, every tier sold out (§6.11)", () => {
  it("shows each tier's total, muted, with 'Sold out' instead of a stepper, then the waitlist; no summary or checkout", () => {
    render(<TicketSelector event={soldOutEvent} />);
    const total = screen.getByText("A$36.90 incl. booking fee");
    expect(total).toHaveClass("text-muted");
    expect(screen.getAllByText("Sold out")).toHaveLength(2);
    expect(screen.queryByRole("group", { name: /Quantity for/ })).toBeNull();
    expect(screen.queryByText("Order summary")).toBeNull();
    expect(screen.queryByRole("button", { name: /Checkout/ })).toBeNull();
    expect(screen.queryByRole("list", { name: "How booking works" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Sold out. Join the waitlist." })).toBeInTheDocument();
    const join = screen.getByRole("button", { name: "Join waitlist" });
    expect(join).toHaveClass("btn-signal", "btn-lg", "w-full");
  });

  it("says the waitlist is closed once the event has ended, with no form", () => {
    render(
      <TicketSelector
        event={{ ...soldOutEvent, startsAt: "2020-01-01T08:00:00.000Z", endsAt: "2020-01-01T10:00:00.000Z" }}
      />,
    );
    expect(screen.getByText("The waitlist for this event is closed.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join waitlist" })).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("in the demo, shows the waitlist disabled and says why", () => {
    render(<TicketSelector event={{ ...soldOutEvent, organiserId: undefined }} />);
    expect(screen.getByRole("button", { name: "Join waitlist" })).toBeDisabled();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Joining the waitlist isn’t available in this demo");
    expect(joinWaitlist).not.toHaveBeenCalled();
  });
});

describe("TicketSelector, one tier sold out, or few left", () => {
  it("a sold-out tier says so and has no stepper; the rest are bookable as usual", () => {
    render(
      <TicketSelector
        event={{ ...soldOutEvent, soldOut: false, ticketTypes: [tier("ga", 3500, { soldOut: true, remaining: 0 }), tier("conc", 2500)] }}
      />,
    );
    expect(screen.getAllByText("Sold out")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Quantity for General admission" })).toBeNull();
    expect(screen.getByRole("group", { name: "Quantity for Concession" })).toBeInTheDocument();
    expect(screen.getByText("Order summary")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Join the waitlist/ })).toBeNull();
  });

  it("says 'Only N left' only from the server's remaining, and caps the stepper there", () => {
    render(<TicketSelector event={{ ...soldOutEvent, soldOut: false, ticketTypes: [tier("ga", 3500, { remaining: 2 }), tier("conc", 2500)] }} />);
    const low = screen.getByText("Only 2 left.");
    expect(low).toHaveClass("text-foreground", "font-semibold");
    expect(low).not.toHaveClass("text-signal");
    // Capacity alone (50) never says "left".
    expect(screen.getAllByText(/left\./)).toHaveLength(1);
    const more = screen.getByRole("button", { name: "Increase quantity for General admission" });
    fireEvent.click(more);
    fireEvent.click(more);
    expect(more).toHaveAttribute("aria-disabled", "true");
    expect(more).toHaveAccessibleDescription("Only 2 left.");
  });

  it("says both when the per-booking cap is lower than what's left", () => {
    render(<TicketSelector event={{ ...soldOutEvent, soldOut: false, ticketTypes: [tier("ga", 3500, { remaining: 10 })] }} />);
    expect(screen.getByText("Only 10 left. Up to 8 per booking.")).toBeInTheDocument();
  });
});

describe("WaitlistBlock (signed out)", () => {
  it("joins with a typed email and says to check the inbox (focused, announced)", async () => {
    joinWaitlist.mockResolvedValue({ status: "confirmation_sent", expiresInHours: 24 });
    render(<WaitlistBlock eventId="evt-1" />);
    expect(getWaitlistStatus).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "guest@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    expect(joinWaitlist).toHaveBeenCalledWith("evt-1", "guest@example.com", undefined);
    const heading = await screen.findByRole("heading", { name: "Check your inbox" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(/We’ve emailed a link to/)).toHaveAttribute("role", "status");
    expect(screen.getByText(/works for 24 hours/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveFocus());
  });

  it("puts a bad email on the field, focused, and sends nothing", async () => {
    render(<WaitlistBlock eventId="evt-1" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    const field = screen.getByLabelText("Email");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(/Enter a valid email address/);
    await waitFor(() => expect(field).toHaveFocus());
    expect(joinWaitlist).not.toHaveBeenCalled();
  });

  it("puts the API's email error on the field", async () => {
    joinWaitlist.mockRejectedValue(new ApiError(400, "Fix the email.", { email: "That email address isn't valid." }));
    render(<WaitlistBlock eventId="evt-1" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toHaveAccessibleDescription(/That email address isn't valid\./));
  });

  it("shows a failure as an alert and keeps the form (503 busy)", async () => {
    joinWaitlist.mockRejectedValue(new ApiError(503, "The waitlist is busy right now. Try again in a few minutes."));
    render(<WaitlistBlock eventId="evt-1" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The waitlist is busy right now.");
    expect(screen.getByRole("button", { name: "Join waitlist" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("a@b.co");
  });

  it("a 409 closes the waitlist with the API's reason, no form", async () => {
    joinWaitlist.mockRejectedValue(new ApiError(409, "Tickets for this event are still on sale, so there's no waitlist."));
    render(<WaitlistBlock eventId="evt-1" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    await waitFor(() =>
      expect(screen.getAllByText("Tickets for this event are still on sale, so there's no waitlist.").length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("button", { name: "Join waitlist" })).toBeNull();
  });

  it("keeps the busy button focused and labelled Joining… while it works", async () => {
    joinWaitlist.mockReturnValue(new Promise(() => {}));
    render(<WaitlistBlock eventId="evt-1" />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "a@b.co" } });
    const button = screen.getByRole("button", { name: "Join waitlist" });
    button.focus();
    fireEvent.click(button);
    const busy = await screen.findByRole("button", { name: "Joining…" });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveFocus();
  });
});

describe("WaitlistBlock (signed in)", () => {
  it("prefills the account email, joins at once and offers Leave", async () => {
    getWaitlistStatus.mockResolvedValue({ joined: false });
    joinWaitlist.mockResolvedValue({ status: "joined", maskedEmail: "m***@example.com", alreadyJoined: false });
    leaveWaitlist.mockResolvedValue(undefined);
    signedIn(<WaitlistBlock eventId="evt-1" />);
    const field = await screen.findByLabelText("Email");
    expect(field).toHaveValue("mia@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Join waitlist" }));
    expect(joinWaitlist).toHaveBeenCalledWith("evt-1", "mia@example.com", expect.any(Function));
    const heading = await screen.findByRole("heading", { name: "You’re on the waitlist" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("m***@example.com")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leave the waitlist" }));
    await waitFor(() => expect(leaveWaitlist).toHaveBeenCalledWith({ eventId: "evt-1", getToken: expect.any(Function) }));
    const again = await screen.findByRole("heading", { name: "Sold out. Join the waitlist." });
    await waitFor(() => expect(again).toHaveFocus());
    expect(screen.getAllByRole("status").some((el) => el.textContent === "You’ve left the waitlist.")).toBe(true);
  });

  it("says they're already on it when the status says so (on load)", async () => {
    getWaitlistStatus.mockResolvedValue({ joined: true, maskedEmail: "m***@example.com" });
    signedIn(<WaitlistBlock eventId="evt-1" />);
    expect(await screen.findByRole("heading", { name: "You’re already on the waitlist" })).toBeInTheDocument();
    // On load, focus isn't moved.
    expect(document.body).toHaveFocus();
    expect(within(screen.getByText(/We’ll email/)).getByText("m***@example.com")).toBeInTheDocument();
  });

  it("a status check that fails still offers the form, and says so", async () => {
    getWaitlistStatus.mockRejectedValue(new ApiError(0, "Couldn't reach the server."));
    signedIn(<WaitlistBlock eventId="evt-1" />);
    expect(await screen.findByText(/couldn’t check whether you’re on the waitlist/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Join waitlist" })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import ReceivedTicket from "@/components/tickets/ReceivedTicket";
import { ApiError } from "@/lib/api/client";
import type { ReceivedTicket as ReceivedTicketRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

const getReceivedTicket = vi.fn();
vi.mock("@/lib/api/ticket-transfers", () => ({ getReceivedTicket: (...args: unknown[]) => getReceivedTicket(...args) }));
vi.mock("@/lib/api/public-events", () => ({ getPublicEventBySlug: () => Promise.reject(new Error("not loaded in this test")) }));
const { api } = vi.hoisted(() => ({ api: { configured: true } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return api.configured;
  },
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

const ID = "0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f";
const RECEIVED: ReceivedTicketRecord = {
  transferId: ID,
  reference: "#0B5C2F8E",
  fromName: "Alex Chen",
  holderName: "Sam Lee",
  acceptedAt: "2027-11-01T00:00:00.000Z",
  status: "valid",
  eventTitle: "Here & Now",
  eventListed: true,
  eventSlug: "here-and-now",
  eventStartsAt: "2027-11-13T06:00:00.000Z",
  eventEndsAt: "2027-11-13T10:00:00.000Z",
  eventTimeZone: "Australia/Melbourne",
  eventState: "VIC",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
  ticket: { ticketCode: "K9QD-4XRT", ticketTypeName: "Second release", checkedInAt: null },
};

function renderPage(auth: Partial<AuthContextValue> = { status: "signed-in", email: "sam@email.com", userId: "u-sam" }, id = ID) {
  return render(
    <FakeAuthProvider value={fakeAuthValue(auth)}>
      <ReceivedTicket transferId={id} />
    </FakeAuthProvider>,
  );
}

beforeEach(() => {
  api.configured = true;
});

afterEach(() => {
  cleanup();
  getReceivedTicket.mockReset();
});

describe("ReceivedTicket", () => {
  it("the member's own ticket: From Alex Chen, the event as the h1, the live QR with the holder, and the transfer's reference", async () => {
    getReceivedTicket.mockResolvedValue(RECEIVED);
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Here & Now" })).toBeInTheDocument();
    expect(getReceivedTicket).toHaveBeenCalledWith(ID, expect.any(Function));
    expect(screen.getByText("From Alex Chen")).toBeInTheDocument();
    expect(screen.getByText("Sat 13 Nov · 5:00 – 9:00 pm AEDT")).toBeInTheDocument();
    const ticket = screen.getByRole("region", { name: "Your ticket" });
    expect(within(ticket).getByRole("img", { name: /K9QD-4XRT/ })).toBeInTheDocument();
    expect(within(ticket).getByText("K9QD-4XRT")).toBeInTheDocument();
    expect(within(ticket).getByText("Sam Lee")).toBeInTheDocument();
    // The order's size is the buyer's business: no "ticket n of N".
    expect(within(ticket).getByText("Show this at the door")).toBeInTheDocument();
    expect(screen.getByText("#0B5C2F8E")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View event page/ })).toHaveAttribute("href", "/events/here-and-now");
    expect(screen.getByRole("button", { name: /Show ticket/ })).toBeInTheDocument();
    // Back to the list it's on.
    expect(screen.getByRole("link", { name: "My tickets" })).toHaveAttribute("href", "/tickets");
  });

  it("no longer valid: says so, with no code anywhere", async () => {
    getReceivedTicket.mockResolvedValue({ ...RECEIVED, status: "void", ticket: undefined });
    const { container } = renderPage();
    expect(await screen.findByText("This ticket is no longer valid. The order it came from was refunded.")).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/K9QD-4XRT/);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /Show ticket/ })).toBeNull();
  });

  it("checked in: the stamp says so, with the time on the door's clock", async () => {
    getReceivedTicket.mockResolvedValue({ ...RECEIVED, ticket: { ...RECEIVED.ticket!, checkedInAt: "2027-11-13T07:42:00.000Z" } });
    renderPage();
    const stamp = await screen.findByText("Checked in", { exact: false });
    expect(stamp.closest("[data-ticket-stamp]")).toHaveTextContent("6:42 pm · Enjoy the night");
  });

  it("an event no longer listed: the ticket says so, with no date, venue, calendar or event link", async () => {
    getReceivedTicket.mockResolvedValue({
      ...RECEIVED,
      eventListed: false,
      eventSlug: undefined,
      eventStartsAt: undefined,
      eventEndsAt: undefined,
      venueName: undefined,
      suburb: undefined,
    });
    renderPage();
    expect(await screen.findByText(/This event is no longer listed/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View event page/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add to calendar" })).toBeNull();
    expect(screen.getByRole("img", { name: /K9QD-4XRT/ })).toBeInTheDocument();
  });

  it("signed out: sign in first, coming back here (the id isn't a credential), and nothing is read", () => {
    renderPage({ status: "signed-out", email: undefined, userId: undefined });
    expect(screen.getByRole("heading", { level: 1, name: "Sign in to see your ticket" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=%2Ftickets%2Freceived%2F${ID}`);
    expect(getReceivedTicket).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: "My tickets" })).toBeNull();
  });

  it("another account's ticket (404) or a malformed id: Ticket not found", async () => {
    getReceivedTicket.mockRejectedValue(new ApiError(404, "Ticket not found."));
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Ticket not found" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "My tickets" })).toHaveAttribute("href", "/tickets");
    cleanup();
    getReceivedTicket.mockClear();
    renderPage(undefined, "not-a-uuid");
    expect(screen.getByRole("heading", { level: 1, name: "Ticket not found" })).toBeInTheDocument();
    expect(getReceivedTicket).not.toHaveBeenCalled();
  });

  it("an error says so, with Try again", async () => {
    getReceivedTicket.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce(RECEIVED);
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Here & Now" })).toBeInTheDocument();
  });

  it("the demo: a notice", () => {
    api.configured = false;
    renderPage();
    expect(screen.getByRole("note")).toHaveTextContent("Tickets sent to you can’t be shown in this demo.");
    expect(getReceivedTicket).not.toHaveBeenCalled();
  });
});

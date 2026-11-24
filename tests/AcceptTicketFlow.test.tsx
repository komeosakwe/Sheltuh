// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AcceptTicketFlow, { OFFER_UNAVAILABLE, acceptErrorMessage } from "@/components/tickets/AcceptTicketFlow";
import { ApiError } from "@/lib/api/client";
import type { TicketOffer, TicketOfferErrorCode } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { TICKET_CODE_PATTERN } from "@/lib/ticket-code";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

const viewTicketOffer = vi.fn();
const acceptTicketOffer = vi.fn();
const declineTicketOffer = vi.fn();
vi.mock("@/lib/api/ticket-transfers", () => ({
  viewTicketOffer: (...args: unknown[]) => viewTicketOffer(...args),
  acceptTicketOffer: (...args: unknown[]) => acceptTicketOffer(...args),
  declineTicketOffer: (...args: unknown[]) => declineTicketOffer(...args),
}));
// The event's public details (its image): optional, none here.
vi.mock("@/lib/api/public-events", () => ({ getPublicEventBySlug: () => Promise.reject(new Error("not loaded in this test")) }));

const { api } = vi.hoisted(() => ({ api: { configured: true } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return api.configured;
  },
}));

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace, prefetch: vi.fn() }) }));

const TOKEN = "T".repeat(40) + "k_-";
const STORAGE_KEY = "sheltuh:ticket-offer";
const TRANSFER_ID = "0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f";
const SIGNED_OUT: Partial<AuthContextValue> = { status: "signed-out", email: undefined, userId: undefined, accessToken: undefined };
const SIGNED_IN: Partial<AuthContextValue> = { status: "signed-in", email: "sam@email.com", userId: "u-sam" };

const OFFER: TicketOffer = {
  status: "open",
  fromName: "Alex Chen",
  toName: "Sam Lee",
  toMaskedEmail: "s***@email.com",
  expiresAt: "2027-11-10T00:00:00.000Z",
  eventTitle: "Here & Now",
  eventListed: true,
  eventSlug: "here-and-now",
  eventStartsAt: "2027-11-13T06:00:00.000Z",
  eventEndsAt: "2027-11-13T10:00:00.000Z",
  eventTimeZone: "Australia/Melbourne",
  eventState: "VIC",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
  ticketTypeName: "Second release",
};

function renderFlow(initial: Partial<AuthContextValue> = SIGNED_IN, { at = `/tickets/accept#token=${TOKEN}` } = {}) {
  window.history.replaceState(null, "", at);
  const signOut = vi.fn();
  const getAccessToken = vi.fn<AuthContextValue["getAccessToken"]>().mockResolvedValue("fake-access-token");
  function Harness() {
    const [overrides, setOverrides] = useState<Partial<AuthContextValue>>(initial);
    const value = fakeAuthValue({
      ...overrides,
      getAccessToken,
      signOut: (scope) => {
        signOut(scope);
        setOverrides((prev) => ({ ...prev, ...SIGNED_OUT }));
      },
    });
    return (
      <FakeAuthProvider value={value}>
        <AcceptTicketFlow />
      </FakeAuthProvider>
    );
  }
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  return { signOut, getAccessToken };
}

beforeEach(() => {
  api.configured = true;
  viewTicketOffer.mockResolvedValue(OFFER);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  viewTicketOffer.mockReset();
  acceptTicketOffer.mockReset();
  declineTicketOffer.mockReset();
  push.mockReset();
  replace.mockReset();
});

describe("AcceptTicketFlow", () => {
  it("reads the token from the fragment, takes it out of the address bar, keeps it in this tab and only reads the offer", async () => {
    renderFlow();
    expect(await screen.findByRole("heading", { level: 1, name: "Alex sent you a ticket" })).toBeInTheDocument();
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/tickets/accept");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(TOKEN);
    expect(viewTicketOffer).toHaveBeenCalledWith(TOKEN, expect.any(Function));
    // Opening the link changes nothing.
    expect(acceptTicketOffer).not.toHaveBeenCalled();
    expect(declineTicketOffer).not.toHaveBeenCalled();
  });

  it("Latte's frame: From Alex Chen, the h1, the line under it, the ticket with its QR locked, Accept and Decline, who's signed in, what each does", async () => {
    renderFlow();
    await screen.findByRole("heading", { level: 1, name: "Alex sent you a ticket" });
    expect(screen.getByText("From Alex Chen")).toBeInTheDocument();
    expect(screen.getByText("Accept it to get your own QR code for the door.")).toBeInTheDocument();
    const ticket = screen.getByRole("article");
    expect(within(ticket).getByRole("heading", { level: 2, name: "Here & Now" })).toBeInTheDocument();
    expect(within(ticket).getByText("Second release")).toBeInTheDocument();
    expect(within(ticket).getByText("Sat 13 Nov")).toBeInTheDocument();
    expect(within(ticket).getByText("Accept the ticket to get your QR code")).toBeInTheDocument();
    // No QR and no code of any kind: the placeholder encodes nothing.
    expect(within(ticket).queryByRole("img")).toBeNull();
    expect(ticket.querySelector("[data-qr-locked]")).not.toBeNull();
    expect(document.body.innerHTML).not.toMatch(new RegExp(TICKET_CODE_PATTERN.source.replace(/^\^|\$$/g, "")));
    expect(screen.getByRole("button", { name: "Accept ticket" })).toHaveClass("btn-signal");
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByText(/Signed in as sam@email.com · Not you\?/)).toBeInTheDocument();
    expect(screen.getByText("Once you accept, Alex’s copy stops working. If you decline, it goes back to Alex.")).toBeInTheDocument();
  });

  it("Your name: the name Alex typed, to confirm, with who it's shared with", async () => {
    renderFlow();
    const name = await screen.findByLabelText("Your name");
    expect(name).toHaveValue("Sam Lee");
    expect(name).toHaveAccessibleDescription(
      "Your name and email are shared with the organiser of this event. Alex will see your name, and your email (partly hidden) if it isn’t the one they sent this to.",
    );
  });

  it("accepts with the confirmed name, forgets the token and goes to the received ticket", async () => {
    acceptTicketOffer.mockResolvedValue({ transferId: TRANSFER_ID });
    renderFlow();
    const name = await screen.findByLabelText("Your name");
    fireEvent.change(name, { target: { value: "  Samantha Lee " } });
    fireEvent.click(screen.getByRole("button", { name: "Accept ticket" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/tickets/received/${TRANSFER_ID}`));
    expect(acceptTicketOffer).toHaveBeenCalledWith(TOKEN, "Samantha Lee", expect.any(Function));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("an empty name is asked for before accepting", async () => {
    renderFlow();
    const name = await screen.findByLabelText("Your name");
    fireEvent.change(name, { target: { value: " " } });
    fireEvent.click(screen.getByRole("button", { name: "Accept ticket" }));
    expect(name).toHaveFocus();
    expect(name).toHaveAccessibleDescription(/^Enter your name/);
    expect(acceptTicketOffer).not.toHaveBeenCalled();
  });

  it.each(["own_ticket", "transfers_closed", "ticket_unavailable", "received_cap", "rate_limited"] as const)(
    "a refused accept (%s) says why, and the page stays",
    async (code: TicketOfferErrorCode) => {
      acceptTicketOffer.mockRejectedValue(new ApiError(code === "rate_limited" ? 429 : 409, "server words", undefined, { code }));
      renderFlow();
      fireEvent.click(await screen.findByRole("button", { name: "Accept ticket" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(acceptErrorMessage(code, "Alex"));
      expect(screen.getByRole("heading", { level: 1, name: "Alex sent you a ticket" })).toBeInTheDocument();
    },
  );

  it("an account whose email isn't confirmed (403) is told to confirm it", async () => {
    acceptTicketOffer.mockRejectedValue(new ApiError(403, "Verify your email address first."));
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Accept ticket" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm your email address to accept this ticket.");
  });

  it("an offer gone while accepting gets the one answer for every unusable offer", async () => {
    acceptTicketOffer.mockRejectedValue(new ApiError(404, OFFER_UNAVAILABLE));
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Accept ticket" }));
    const heading = await screen.findByRole("heading", { level: 1, name: OFFER_UNAVAILABLE });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("Ask the person who sent it to send it again.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find events" })).toHaveAttribute("href", "/events");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("an offer that can't be opened (expired, used, cancelled, unknown: one 404) says so, and the token is forgotten", async () => {
    viewTicketOffer.mockRejectedValue(new ApiError(404, OFFER_UNAVAILABLE));
    renderFlow();
    expect(await screen.findByRole("heading", { level: 1, name: OFFER_UNAVAILABLE })).toBeInTheDocument();
    await waitFor(() => expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull());
  });

  it("already accepted by this account: straight to its ticket", async () => {
    viewTicketOffer.mockResolvedValue({ status: "accepted", transferId: TRANSFER_ID });
    renderFlow();
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/tickets/received/${TRANSFER_ID}`));
  });

  it("signed out: the owner's wording, Sign in to accept and Create account (back here), and Decline", async () => {
    renderFlow(SIGNED_OUT);
    await screen.findByRole("heading", { level: 1, name: "Alex sent you a ticket" });
    expect(viewTicketOffer).toHaveBeenCalledWith(TOKEN, undefined);
    expect(screen.getByText("Sign in or create an account, then accept to get your own QR code.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to accept" })).toHaveAttribute("href", "/login?next=%2Ftickets%2Faccept");
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute("href", "/signup?next=%2Ftickets%2Faccept");
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Your name")).toBeNull();
    expect(screen.queryByText(/Signed in as/)).toBeNull();
  });

  it("back from signing in (no fragment): the token this tab kept", async () => {
    sessionStorage.setItem(STORAGE_KEY, TOKEN);
    renderFlow(SIGNED_IN, { at: "/tickets/accept" });
    await screen.findByRole("heading", { level: 1, name: "Alex sent you a ticket" });
    expect(viewTicketOffer).toHaveBeenCalledWith(TOKEN, expect.any(Function));
  });

  it("no token anywhere: asks for the email's link", async () => {
    renderFlow(SIGNED_IN, { at: "/tickets/accept" });
    expect(await screen.findByRole("heading", { level: 1, name: "Open the link in your email" })).toBeInTheDocument();
    expect(viewTicketOffer).not.toHaveBeenCalled();
  });

  it("Switch account signs out here and goes to sign in, keeping the token", async () => {
    const { signOut } = renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Switch account" }));
    expect(signOut).toHaveBeenCalledWith("local");
    expect(push).toHaveBeenCalledWith("/login?next=%2Ftickets%2Faccept");
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe(TOKEN);
  });

  it("Decline asks first; Keep it goes back; Decline ticket declines and says Alex was told", async () => {
    declineTicketOffer.mockResolvedValue({ status: "declined" });
    renderFlow(SIGNED_OUT);
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    const question = await screen.findByRole("heading", { level: 2, name: "Decline this ticket?" });
    await waitFor(() => expect(question).toHaveFocus());
    expect(screen.getByText("It goes back to Alex.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Decline" })).toHaveFocus());
    expect(declineTicketOffer).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Decline ticket" }));
    const done = await screen.findByRole("heading", { level: 1, name: "You declined the ticket" });
    expect(declineTicketOffer).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText("We’ve let Alex know.")).toBeInTheDocument();
    await waitFor(() => expect(done).toHaveFocus());
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("the email's Decline (&decline=1) opens on the question, and still declines only when pressed", async () => {
    renderFlow(SIGNED_OUT, { at: `/tickets/accept#token=${TOKEN}&decline=1` });
    expect(await screen.findByRole("heading", { level: 2, name: "Decline this ticket?" })).toBeInTheDocument();
    expect(declineTicketOffer).not.toHaveBeenCalled();
  });

  it("the demo: a notice, and nothing is read", async () => {
    api.configured = false;
    renderFlow();
    expect(await screen.findByRole("heading", { level: 1, name: "Ticket offers work on the live site" })).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("Ticket offers can’t be opened in this demo. Nothing was changed.");
    expect(viewTicketOffer).not.toHaveBeenCalled();
  });
});

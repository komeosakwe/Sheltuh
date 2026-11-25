// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MyTicketsList, { REFRESH_AFTER_MS } from "@/components/tickets/MyTicketsList";
import { ApiError } from "@/lib/api/client";
import type { MyTicketOrderItem, MyTicketReceivedItem, MyTicketsPage } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { FakeAuthProvider, fakeAuthValue } from "./test-utils/fakeAuth";

const listMyTickets = vi.fn();
vi.mock("@/lib/api/me", () => ({ listMyTickets: (...args: unknown[]) => listMyTickets(...args) }));
const { api } = vi.hoisted(() => ({ api: { configured: true } }));
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  get isApiConfigured() {
    return api.configured;
  },
}));

const EVENT = {
  eventListed: true,
  eventStartsAt: "2099-11-13T06:00:00.000Z",
  eventEndsAt: "2099-11-13T10:00:00.000Z",
  eventTimeZone: "Australia/Melbourne",
  eventState: "VIC",
  venueName: "Interconnect Studio",
  suburb: "Coburg North",
} as const;

function order(id: string, title: string, overrides: Partial<MyTicketOrderItem> = {}): MyTicketOrderItem {
  return {
    kind: "order",
    section: "upcoming",
    ...EVENT,
    eventTitle: title,
    eventSlug: id,
    orderId: id,
    status: "paid",
    totalCents: 2594,
    ticketCount: 1,
    heldCount: 1,
    pendingCount: 0,
    checkedInCount: 0,
    ticketTypeName: "Second release",
    ...overrides,
  };
}

const RECEIVED: MyTicketReceivedItem = {
  kind: "received",
  section: "upcoming",
  ...EVENT,
  eventTitle: "High Note",
  eventSlug: "high-note",
  transferId: "0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f",
  reference: "#0B5C2F8E",
  status: "valid",
  fromName: "Alex Chen",
  holderName: "Sam Lee",
  acceptedAt: "2099-10-30T00:00:00.000Z",
  ticketTypeName: "General admission",
};

const PAST = order("o-past", "Old Show", { section: "past", eventStartsAt: "2020-03-06T09:00:00.000Z", eventEndsAt: "2020-03-06T12:00:00.000Z" });

/** A read that answers when the test says (and never on its own). */
function deferred<T>() {
  const box: { resolve: (value: T) => void } = { resolve: () => undefined };
  const promise = new Promise<T>((resolve) => {
    box.resolve = resolve;
  });
  return { promise, resolve: (value: T) => box.resolve(value) };
}

const statusLine = () => document.querySelector("[data-my-tickets-status]");

/** Back on the tab (visibilitychange) or back from the browser's cache (pageshow, persisted). */
function comeBack(kind: "tab" | "cache" = "tab") {
  act(() => {
    if (kind === "tab") document.dispatchEvent(new Event("visibilitychange"));
    else window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
  });
}

function page(items: MyTicketsPage["items"], counts: MyTicketsPage["counts"], nextCursor?: string): MyTicketsPage {
  return { items, counts, ...(nextCursor ? { nextCursor } : {}) };
}

function renderList(auth: Partial<AuthContextValue> = { status: "signed-in", email: "sam@email.com", userId: "u-sam" }) {
  return render(
    <FakeAuthProvider value={fakeAuthValue(auth)}>
      <h1>My tickets</h1>
      <MyTicketsList />
    </FakeAuthProvider>,
  );
}

beforeEach(() => {
  api.configured = true;
  listMyTickets.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("My tickets — the states", () => {
  it("the demo: the sample cards in both lists, with no API call", () => {
    api.configured = false;
    renderList(fakeAuthValue({ configured: false, status: "signed-out" }));
    expect(screen.getByRole("note")).toHaveTextContent("Sample tickets");
    expect(screen.getByRole("heading", { level: 2, name: "Upcoming, 3" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Past, 2" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(5);
    expect(listMyTickets).not.toHaveBeenCalled();
  });

  it("the demo on the server (the static page): only the card shapes, no dates to differ when it hydrates", () => {
    api.configured = false;
    const html = renderToString(
      <FakeAuthProvider value={fakeAuthValue({ configured: false, status: "signed-out" })}>
        <MyTicketsList />
      </FakeAuthProvider>,
    );
    expect(html).toContain("data-my-tickets-loading");
    expect(html).not.toContain("Upcoming");
    expect(html).not.toMatch(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d/);
  });

  it("while auth loads: the card shapes, said once on the status line outside them, and no request", () => {
    const { container } = renderList({ status: "loading" });
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(statusLine()).toHaveTextContent("Loading your tickets…");
    expect(statusLine()?.closest("[aria-busy]")).toBeNull();
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(container.querySelectorAll("[data-my-tickets-loading] li")).toHaveLength(3);
    expect(listMyTickets).not.toHaveBeenCalled();
  });

  it("signed out: a heading, sign in back to /tickets; bought without an account, the email", () => {
    renderList({ status: "signed-out", email: undefined });
    expect(screen.getByRole("heading", { level: 2, name: "Sign in to see your tickets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login?next=%2Ftickets");
    expect(screen.getByText(/Bought without an account\? Check your email/)).toBeInTheDocument();
    expect(listMyTickets).not.toHaveBeenCalled();
  });

  it("an unverified email (403): Verify your email, on /verify with the address, back to /tickets", async () => {
    listMyTickets.mockRejectedValue(new ApiError(403, "Verify your email"));
    renderList();
    expect(await screen.findByRole("heading", { level: 2, name: "Verify your email to see your tickets" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verify your email" })).toHaveAttribute("href", "/verify?email=sam%40email.com&next=%2Ftickets");
  });

  it("a session that ended (401): sign in again", async () => {
    listMyTickets.mockRejectedValue(new ApiError(401, "Sign in"));
    renderList();
    expect(await screen.findByRole("heading", { level: 2, name: "Sign in again to see your tickets" })).toBeInTheDocument();
  });

  it("an error is shown; Try again loads the list, focuses its first heading and says the counts", async () => {
    listMyTickets.mockRejectedValueOnce(new ApiError(500, "boom")).mockResolvedValueOnce(page([order("o1", "Here & Now")], { upcoming: 1, past: 0 }));
    renderList();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load your tickets. Check your connection, then try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Here & Now" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Upcoming, 1" })).toHaveFocus());
    expect(statusLine()).toHaveTextContent("Your tickets: 1 upcoming, 0 past.");
    expect(listMyTickets).toHaveBeenCalledTimes(2);
  });

  it("an error again after Try again: focus stays on Try again", async () => {
    listMyTickets.mockRejectedValue(new ApiError(500, "boom"));
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus());
  });

  it("no tickets: says so, with Find an event", async () => {
    listMyTickets.mockResolvedValue(page([], { upcoming: 0, past: 0 }));
    renderList();
    expect(await screen.findByText("No tickets yet.", { selector: "[data-my-tickets-focus]" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Find an event" })).toHaveAttribute("href", "/events");
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(statusLine()).toHaveTextContent("No tickets yet.");
  });

  it("nothing upcoming but past tickets: Upcoming says nothing's coming up", async () => {
    listMyTickets.mockResolvedValue(page([PAST], { upcoming: 0, past: 1 }));
    renderList();
    expect(await screen.findByRole("heading", { level: 2, name: "Upcoming, 0" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing coming up/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Past, 1" })).toBeInTheDocument();
  });
});

describe("My tickets — the lists", () => {
  it("Upcoming and Past with their counts; each card links to its page by name, with no code anywhere", async () => {
    listMyTickets.mockResolvedValue(page([order("o1", "Here & Now"), RECEIVED, PAST], { upcoming: 2, past: 1 }));
    const { container } = renderList();
    const upcoming = await screen.findByRole("region", { name: "Upcoming, 2" });
    const past = screen.getByRole("region", { name: "Past, 1" });
    expect(statusLine()).toHaveTextContent("Your tickets: 2 upcoming, 1 past.");
    expect(within(upcoming).getAllByRole("article")).toHaveLength(2);
    expect(within(upcoming).getByRole("link", { name: "Show ticket, Here & Now" })).toHaveAttribute("href", "/checkout/success?session_id=o1");
    expect(within(upcoming).getByRole("link", { name: "Show ticket, High Note" })).toHaveAttribute(
      "href",
      "/tickets/received/0b5c2f8e-7d6a-4c1b-9e3f-2a1d4c5b6e7f",
    );
    expect(within(upcoming).getByText("From Alex")).toBeInTheDocument();
    const pastCard = within(past).getByRole("article");
    expect(pastCard).toHaveAttribute("data-state", "ended");
    expect(within(pastCard).getByRole("link", { name: "View order, Old Show" })).toHaveAttribute("href", "/checkout/success?session_id=o-past");
    expect(within(pastCard).queryByRole("link", { name: /Show ticket/ })).toBeNull();
    expect(container.textContent).not.toMatch(/#0B5C2F8E|K9QD/);
  });

  it("Show N more: under Upcoming while its cards are loading (Past waits), then under Past; a repeated card isn't added twice", async () => {
    const first = page([order("o1", "First")], { upcoming: 2, past: 1 }, "c1");
    // The second page repeats o1 (it moved while the pages were read) and brings o2 and the past card.
    const second = page([order("o1", "First"), order("o2", "Second"), PAST], { upcoming: 2, past: 1 });
    listMyTickets.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    renderList();
    const upcoming = await screen.findByRole("region", { name: "Upcoming, 2" });
    expect(within(upcoming).getByRole("button", { name: "Show 2 more" })).toBeInTheDocument();
    expect(screen.getByText("Show all your upcoming tickets to see these.")).toBeInTheDocument();

    fireEvent.click(within(upcoming).getByRole("button", { name: "Show 2 more" }));
    expect(statusLine()).toHaveTextContent("Loading more tickets…");
    expect(listMyTickets).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ cursor: "c1" }));
    await waitFor(() => expect(within(upcoming).getAllByRole("article")).toHaveLength(2));
    // Focus and the announcement follow once the new cards are drawn.
    await waitFor(() => expect(within(upcoming).getByRole("link", { name: "Show ticket, Second" })).toHaveFocus());
    expect(statusLine()).toHaveTextContent("2 more tickets shown.");
    expect(within(screen.getByRole("region", { name: "Past, 1" })).getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Show/ })).toBeNull();
  });

  it("the counts drifted (a card moved to Past between reads): Show more goes by the cards loaded, under Past, and Past shows", async () => {
    // Still counted as 3 upcoming, but the page has reached a past card.
    listMyTickets.mockResolvedValueOnce(page([order("o1", "First"), PAST], { upcoming: 3, past: 1 }, "c1"));
    renderList();
    const past = await screen.findByRole("region", { name: "Past, 1" });
    expect(within(past).getByRole("button", { name: /^Show/ })).toBeInTheDocument();
    expect(within(past).getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText("Show all your upcoming tickets to see these.")).toBeNull();
    expect(within(screen.getByRole("region", { name: "Upcoming, 3" })).queryByRole("button")).toBeNull();
  });

  it("a page that brings nothing new: focus stays on Show more and it says No more tickets; with no more pages, the heading", async () => {
    listMyTickets
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 3, past: 0 }, "c1"))
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 3, past: 0 }, "c2"))
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 1, past: 0 }));
    renderList();
    const upcoming = await screen.findByRole("region", { name: "Upcoming, 3" });
    const button = within(upcoming).getByRole("button", { name: "Show 2 more" });
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(statusLine()).toHaveTextContent("No more tickets."));
    expect(within(upcoming).getByRole("button", { name: /^Show/ })).toHaveFocus();
    fireEvent.click(within(upcoming).getByRole("button", { name: /^Show/ }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Upcoming, 1" })).toHaveFocus());
    expect(screen.queryByRole("button", { name: /^Show/ })).toBeNull();
  });

  it("a page that fails to load says so, and Try again asks for it again", async () => {
    listMyTickets
      .mockResolvedValueOnce(page([order("o1", "First"), PAST], { upcoming: 1, past: 2 }, "c1"))
      .mockRejectedValueOnce(new ApiError(500, "boom"))
      .mockResolvedValueOnce(page([order("o3", "Older", { section: "past" })], { upcoming: 1, past: 2 }));
    renderList();
    const past = await screen.findByRole("region", { name: "Past, 2" });
    fireEvent.click(within(past).getByRole("button", { name: "Show 1 more" }));
    expect(await within(past).findByRole("alert")).toHaveTextContent("Couldn’t load more tickets.");
    fireEvent.click(within(past).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(past).getAllByRole("article")).toHaveLength(2));
    expect(listMyTickets).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ cursor: "c1" }));
  });

  it("Show more answering 401: the list gives way to Sign in again, its title focused", async () => {
    listMyTickets.mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 2, past: 0 }, "c1")).mockRejectedValueOnce(new ApiError(401, "Sign in"));
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Show 1 more" }));
    const title = await screen.findByRole("heading", { level: 2, name: "Sign in again to see your tickets" });
    await waitFor(() => expect(title).toHaveFocus());
  });
});

describe("My tickets — reading the list again", () => {
  it("back on the tab after a while: read again; the focused card is found in its new list, and it's said", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    listMyTickets
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 1, past: 0 }))
      .mockResolvedValueOnce(page([order("o1", "First", { section: "past" })], { upcoming: 0, past: 1 }));
    renderList();
    const upcoming = await screen.findByRole("region", { name: "Upcoming, 1" });
    within(upcoming).getByRole("link", { name: "Show ticket, First" }).focus();

    // Soon after: nothing to do.
    comeBack();
    expect(listMyTickets).toHaveBeenCalledTimes(1);

    now.mockReturnValue(start + REFRESH_AFTER_MS + 1);
    comeBack();
    const past = await screen.findByRole("region", { name: "Past, 1" });
    expect(listMyTickets).toHaveBeenCalledTimes(2);
    expect(within(past).getByRole("article")).toHaveAttribute("data-state", "ended");
    await waitFor(() => expect(within(past).getByRole("link", { name: "View order, First" })).toHaveFocus());
    expect(statusLine()).toHaveTextContent("Your tickets were updated.");
  });

  it("back from the browser's cache (pageshow, persisted): read again at once", async () => {
    listMyTickets
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 1, past: 0 }))
      .mockResolvedValueOnce(page([order("o1", "First"), order("o2", "Second")], { upcoming: 2, past: 0 }));
    renderList();
    await screen.findByRole("region", { name: "Upcoming, 1" });
    comeBack("cache");
    expect(await screen.findByRole("region", { name: "Upcoming, 2" })).toBeInTheDocument();
    expect(listMyTickets).toHaveBeenCalledTimes(2);
  });

  it("after Show more, coming back doesn't read the list again (it would take the cards asked for away)", async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, "now").mockReturnValue(start);
    listMyTickets
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 2, past: 0 }, "c1"))
      .mockResolvedValueOnce(page([order("o2", "Second")], { upcoming: 2, past: 0 }));
    renderList();
    fireEvent.click(await screen.findByRole("button", { name: "Show 1 more" }));
    await screen.findByRole("heading", { level: 3, name: "Second" });
    now.mockReturnValue(start + REFRESH_AFTER_MS + 1);
    comeBack();
    comeBack("cache");
    expect(listMyTickets).toHaveBeenCalledTimes(2);
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("Show more while a refresh is on its way: the page wins, and the refresh's answer is dropped", async () => {
    const refreshRead = deferred<MyTicketsPage>();
    listMyTickets
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 2, past: 0 }, "c1"))
      .mockReturnValueOnce(refreshRead.promise)
      .mockResolvedValueOnce(page([order("o2", "Second")], { upcoming: 2, past: 0 }));
    renderList();
    await screen.findByRole("region", { name: "Upcoming, 2" });
    comeBack("cache");
    expect(listMyTickets).toHaveBeenCalledTimes(2);
    const refreshSignal = (listMyTickets.mock.calls[1][1] as { signal: AbortSignal }).signal;
    fireEvent.click(screen.getByRole("button", { name: "Show 1 more" }));
    expect(refreshSignal.aborted).toBe(true);
    await screen.findByRole("heading", { level: 3, name: "Second" });
    await act(async () => {
      refreshRead.resolve(page([order("o9", "Stale")], { upcoming: 1, past: 0 }));
    });
    expect(screen.queryByRole("heading", { level: 3, name: "Stale" })).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it.each([
    [401, "Sign in again to see your tickets"],
    [403, "Verify your email to see your tickets"],
  ])("a refresh answering %s: the list gives way to that state, its title focused", async (code, title) => {
    listMyTickets.mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 1, past: 0 })).mockRejectedValueOnce(new ApiError(code, "no"));
    renderList();
    await screen.findByRole("region", { name: "Upcoming, 1" });
    comeBack("cache");
    const heading = await screen.findByRole("heading", { level: 2, name: title });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("a refresh that fails keeps the cards and says so; Try again reads it, focuses Upcoming and says Tickets updated", async () => {
    listMyTickets
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 1, past: 0 }))
      .mockRejectedValueOnce(new ApiError(500, "boom"))
      .mockResolvedValueOnce(page([order("o1", "First")], { upcoming: 1, past: 0 }));
    renderList();
    await screen.findByRole("region", { name: "Upcoming, 1" });
    comeBack("cache");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t check for changes.");
    expect(screen.getByRole("heading", { level: 3, name: "First" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Upcoming, 1" })).toHaveFocus());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(statusLine()).toHaveTextContent("Tickets updated.");
  });
});

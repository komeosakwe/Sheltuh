// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DashboardContent from "@/components/dashboard/DashboardContent";
import type { EventRecord, OrganiserRecord } from "@/lib/api/types";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

const listMyEvents = vi.fn();
vi.mock("@/lib/api/events", () => ({
  listMyEvents: (...args: unknown[]) => listMyEvents(...args),
}));

let organiser: Pick<OrganiserRecord, "organiserId" | "status" | "payoutsEnabled"> = { organiserId: "org-1", status: "approved" };
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({
    loading: false,
    organiser,
    error: null,
    refetch: vi.fn(),
  }),
}));

afterEach(cleanup);
beforeEach(() => {
  listMyEvents.mockReset();
  organiser = { organiserId: "org-1", status: "approved" };
});

function makeRecord(id: string, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    organiserId: "org-1",
    eventId: id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category: "live-music",
    venueName: "v",
    venueAddress: "a",
    suburb: "s",
    startsAt: "2026-12-01T09:00:00.000Z",
    endsAt: "2026-12-01T12:00:00.000Z",
    organiserName: "Org",
    ticketTypes: [],
    status: "draft",
    moderationLog: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderDashboard() {
  render(
    <FakeAuthProvider value={fakeAuthValue()}>
      <DashboardContent />
    </FakeAuthProvider>,
  );
}

describe("DashboardContent — pagination over the organiser's own events", () => {
  it("loads more than one page via 'Load more'", async () => {
    listMyEvents
      .mockResolvedValueOnce({ items: [makeRecord("a"), makeRecord("b")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeRecord("c")], nextCursor: undefined });

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Event a")).toBeInTheDocument());
    expect(screen.queryByText("Event c")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(screen.getByText("Event c")).toBeInTheDocument());
    expect(screen.getByText("Event a")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(listMyEvents).toHaveBeenCalledTimes(2);
    expect(listMyEvents.mock.calls[1][1]).toBe("cursor-1");
  });

  it("skips past an empty page that still carries a cursor to reach a later page with results", async () => {
    listMyEvents
      .mockResolvedValueOnce({ items: [], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeRecord("later")], nextCursor: undefined });

    renderDashboard();

    await waitFor(() => expect(screen.getByText("Event later")).toBeInTheDocument());
    expect(screen.queryByText(/haven.t created any events/i)).not.toBeInTheDocument();
  });

  it("de-duplicates an event that appears again across adjacent pages", async () => {
    listMyEvents
      .mockResolvedValueOnce({ items: [makeRecord("a"), makeRecord("b")], nextCursor: "cursor-1" })
      .mockResolvedValueOnce({ items: [makeRecord("b"), makeRecord("c")], nextCursor: undefined });

    renderDashboard();
    await waitFor(() => expect(screen.getByText("Event a")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Event c")).toBeInTheDocument());

    expect(screen.getAllByText("Event b")).toHaveLength(1);
  });
});

/** The row (an li) of the event with this title. */
function rowOf(title: string): HTMLElement {
  const row = screen.getByRole("heading", { level: 2, name: title }).closest("li");
  if (!row) throw new Error(`No row for ${title}`);
  return row;
}

/** The row's actions: [visible words, accessible name, href]. */
function actionsOf(title: string): [string | null, string | null, string | null][] {
  const list = within(rowOf(title)).getByRole("list", { name: `Actions for ${title}` });
  return within(list)
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("aria-label"), link.getAttribute("href")]);
}

describe("DashboardContent — New event is an action, not a tab", () => {
  it("sits beside the Your events heading, as an outlined button that's never marked current", async () => {
    listMyEvents.mockResolvedValueOnce({ items: [makeRecord("a", { title: "Night Market" })], nextCursor: undefined });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Night Market")).toBeInTheDocument());
    const heading = screen.getByRole("heading", { level: 1, name: "Your events" });
    const newEvent = screen.getByRole("link", { name: "New event" });
    expect(newEvent).toHaveAttribute("href", "/dashboard/new");
    expect(newEvent).not.toHaveAttribute("aria-current");
    expect(newEvent).toHaveClass("btn-outline", "min-h-11");
    expect(newEvent).not.toHaveClass("btn-solid");
    // In the page header with the h1, not in a row of section links.
    expect(heading.closest("header")?.contains(newEvent)).toBe(true);
    // The sections live in the organiser sub-nav (the layout's), not here.
    for (const name of ["Payouts", "Public profile"]) {
      expect(screen.queryByRole("link", { name })).toBeNull();
    }
  });

  it("isn't offered until the organiser can create events", () => {
    organiser = { organiserId: "org-1", status: "pending" };
    renderDashboard();
    expect(screen.getByRole("heading", { level: 1, name: "Your events" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "New event" })).toBeNull();
    expect(screen.getByText("Your organiser application is still pending review.")).toBeInTheDocument();
    expect(listMyEvents).not.toHaveBeenCalled();
  });

  it("is a 1.75 stroke plus, hidden from screen readers", async () => {
    listMyEvents.mockResolvedValueOnce({ items: [makeRecord("a")], nextCursor: undefined });
    renderDashboard();
    const newEvent = await screen.findByRole("link", { name: "New event" });
    const icon = newEvent.querySelector("svg");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon).toHaveAttribute("stroke-width", "1.75");
  });

  it("isn't in the header while the list loads or is empty (the empty state has Create your first event)", async () => {
    let resolve: (page: { items: EventRecord[] }) => void = () => {};
    listMyEvents.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    renderDashboard();
    await waitFor(() => expect(listMyEvents).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "New event" })).toBeNull();
    resolve({ items: [] });
    await screen.findByRole("link", { name: "Create your first event" });
    expect(screen.queryByRole("link", { name: "New event" })).toBeNull();
  });

  it("stays offered when the list couldn't load", async () => {
    listMyEvents.mockRejectedValueOnce(new Error("Couldn't load your events."));
    renderDashboard();
    await screen.findByRole("alert");
    expect(screen.getByRole("link", { name: "New event" })).toHaveAttribute("href", "/dashboard/new");
  });
});

describe("DashboardContent — empty state", () => {
  it("invites the organiser to create their first event", async () => {
    listMyEvents.mockResolvedValueOnce({ items: [], nextCursor: undefined });
    renderDashboard();
    const create = await screen.findByRole("link", { name: "Create your first event" });
    expect(create).toHaveAttribute("href", "/dashboard/new");
    expect(create).toHaveClass("min-h-11");
    expect(screen.getByText("No events yet")).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("DashboardContent — each event's status, date and actions", () => {
  const SEATING = { version: 1, seatCount: 120 };

  it("says the status in words, with the date and suburb", async () => {
    listMyEvents.mockResolvedValueOnce({
      items: [
        makeRecord("d", { title: "dad", suburb: "Taylors Lakes", startsAt: "2026-12-12T08:00:00.000Z" }),
        makeRecord("p", { title: "Waiting", status: "pending_review" }),
        makeRecord("l", { title: "Live", status: "published" }),
        makeRecord("r", { title: "Nope", status: "rejected" }),
        makeRecord("u", { title: "Taken down", status: "draft", ticketingLocked: true }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("dad")).toBeInTheDocument());
    // The year shows only outside the current one.
    expect(rowOf("dad")).toHaveTextContent(/Sat 12 Dec( 2026)?, 7:00 pm · Taylors Lakes/);
    const statusOf = (title: string) => rowOf(title).getAttribute("data-status");
    expect(within(rowOf("dad")).getByText("Draft")).toBeInTheDocument();
    expect(within(rowOf("Waiting")).getByText("Waiting for review")).toBeInTheDocument();
    expect(within(rowOf("Live")).getByText("Published")).toBeInTheDocument();
    expect(within(rowOf("Nope")).getByText("Rejected")).toBeInTheDocument();
    expect(within(rowOf("Taken down")).getByText("Unpublished")).toBeInTheDocument();
    expect(["dad", "Waiting", "Live", "Nope", "Taken down"].map(statusOf)).toEqual([
      "draft",
      "pending_review",
      "published",
      "rejected",
      "unpublished",
    ]);
  });

  it("offers only the actions that apply, each named with the event and 44px tall", async () => {
    listMyEvents.mockResolvedValueOnce({
      items: [
        makeRecord("d", { title: "dad" }),
        makeRecord("p", { title: "Waiting", status: "pending_review", seating: SEATING }),
        makeRecord("l", { title: "Live", slug: "live-night", status: "published", seating: SEATING }),
        makeRecord("x", { title: "Elsewhere", slug: "elsewhere", status: "published", ticketingMode: "external" }),
        makeRecord("r", { title: "Nope", status: "rejected" }),
        makeRecord("u", { title: "Taken down", status: "draft", ticketingLocked: true }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("dad")).toBeInTheDocument());

    expect(actionsOf("dad")).toEqual([
      ["Edit", "Edit dad", "/dashboard/d"],
      ["Analytics", "Analytics for dad", "/dashboard/events/d/analytics"],
    ]);
    // Waiting for review can't be edited (the API refuses): View submission, and its seat map.
    expect(actionsOf("Waiting")).toEqual([
      ["View submission", "View submission for Waiting", "/dashboard/p"],
      ["Analytics", "Analytics for Waiting", "/dashboard/events/p/analytics"],
      ["Seat map", "Seat map for Waiting", "/dashboard/p/seat-map"],
    ]);
    // Published: no View (the editor is locked); its public page is the main action.
    expect(actionsOf("Live")).toEqual([
      ["View public page", "View public page for Live", "/events/live-night"],
      ["Analytics", "Analytics for Live", "/dashboard/events/l/analytics"],
      ["Check-in", "Check-in for Live", "/dashboard/l/check-in"],
      ["Seat map", "Seat map for Live", "/dashboard/l/seat-map"],
    ]);
    // Ticketed on another site: no door check-in here.
    expect(actionsOf("Elsewhere")).toEqual([
      ["View public page", "View public page for Elsewhere", "/events/elsewhere"],
      ["Analytics", "Analytics for Elsewhere", "/dashboard/events/x/analytics"],
    ]);
    expect(actionsOf("Nope").map(([label]) => label)).toEqual(["Edit", "Analytics"]);
    expect(actionsOf("Taken down").map(([label]) => label)).toEqual(["Edit", "Analytics"]);

    for (const link of within(within(rowOf("Live")).getByRole("list", { name: "Actions for Live" })).getAllByRole("link")) {
      expect(link).toHaveClass("min-h-11");
    }
    // The main action is the outlined button; the rest are tertiary links (underlined words).
    expect(screen.getByRole("link", { name: "View public page for Live" })).toHaveClass("btn-outline");
    expect(screen.getByRole("link", { name: "Edit dad" })).toHaveClass("btn-outline");
    expect(screen.getByRole("link", { name: "View submission for Waiting" })).toHaveClass("btn-outline");
    for (const name of ["Analytics for Live", "Check-in for Live", "Seat map for Live"]) {
      const link = screen.getByRole("link", { name });
      expect(link).not.toHaveClass("btn");
      expect(link).toHaveClass("underline", "text-sm", "font-semibold");
    }
  });

  it("a published event without a slug still has a way in: View", async () => {
    listMyEvents.mockResolvedValueOnce({ items: [makeRecord("l", { title: "Live", slug: "", status: "published" })] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Live")).toBeInTheDocument());
    expect(actionsOf("Live")[0]).toEqual(["View", "View Live", "/dashboard/l"]);
  });

  it("each status's hint: a rejected event points at Edit; a published one links Contact Sheltüh to support", async () => {
    listMyEvents.mockResolvedValueOnce({
      items: [
        makeRecord("r", { title: "Nope", status: "rejected" }),
        makeRecord("l", { title: "Live", status: "published" }),
        makeRecord("p", { title: "Waiting", status: "pending_review" }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Nope")).toBeInTheDocument());
    expect(rowOf("Nope")).toHaveTextContent("Open Edit to read the reviewer’s note.");
    expect(rowOf("Live")).toHaveTextContent("Live on Sheltüh. Contact Sheltüh to change it.");
    expect(within(rowOf("Live")).getByRole("link", { name: "Contact Sheltüh" })).toHaveAttribute(
      "href",
      "mailto:support@sheltuh.com.au",
    );
    expect(within(rowOf("Waiting")).queryByRole("link", { name: "Contact Sheltüh" })).toBeNull();
    // Hint lines wrap evenly.
    expect(within(rowOf("Nope")).getByText("Open Edit to read the reviewer’s note.")).toHaveClass("text-pretty");
  });

  it("wraps the actions instead of scrolling sideways", async () => {
    listMyEvents.mockResolvedValueOnce({ items: [makeRecord("l", { title: "Live", status: "published" })] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Live")).toBeInTheDocument());
    expect(within(rowOf("Live")).getByRole("list", { name: "Actions for Live" })).toHaveClass(
      "flex",
      "flex-wrap",
      "items-center",
      "gap-x-4",
      "gap-y-0",
    );
  });
});

describe("DashboardContent — payouts before submitting paid events", () => {
  it("marks a draft or rejected event with paid Sheltüh tickets while payouts aren't set up", async () => {
    const paid = [{ id: "t", name: "GA", priceCents: 2000, feePolicy: "buyer-pays" as const, quantityAvailable: 10 }];
    const free = [{ ...paid[0], priceCents: 0 }];
    listMyEvents.mockResolvedValueOnce({
      items: [
        makeRecord("paid-draft", { ticketTypes: paid }),
        makeRecord("paid-rejected", { ticketTypes: paid, status: "rejected" }),
        makeRecord("free-draft", { ticketTypes: free }),
        makeRecord("external-draft", { ticketTypes: [], ticketingMode: "external" }),
        makeRecord("paid-pending", { ticketTypes: paid, status: "pending_review" }),
      ],
    });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Event paid-draft")).toBeInTheDocument());
    const hint = "Paid tickets: set up payouts before you submit it.";
    expect(rowOf("Event paid-draft")).toHaveTextContent(hint);
    expect(rowOf("Event paid-rejected")).toHaveTextContent(hint);
    expect(rowOf("Event free-draft")).not.toHaveTextContent(hint);
    expect(rowOf("Event external-draft")).not.toHaveTextContent(hint);
    expect(rowOf("Event paid-pending")).not.toHaveTextContent(hint);
    // The row's own link to payouts, and the banner's.
    expect(within(rowOf("Event paid-draft")).getByRole("link", { name: "set up payouts" })).toHaveAttribute(
      "href",
      "/dashboard/payouts",
    );
    for (const link of screen.getAllByRole("link", { name: "set up payouts" })) {
      expect(link).toHaveAttribute("href", "/dashboard/payouts");
    }
  });

  it("drops the banner and the marks once payouts are set up", async () => {
    organiser = { organiserId: "org-1", status: "approved", payoutsEnabled: true };
    const paid = [{ id: "t", name: "GA", priceCents: 2000, feePolicy: "buyer-pays" as const, quantityAvailable: 10 }];
    listMyEvents.mockResolvedValueOnce({ items: [makeRecord("paid-draft", { ticketTypes: paid })] });
    renderDashboard();
    await waitFor(() => expect(screen.getByText("Event paid-draft")).toBeInTheDocument());
    expect(rowOf("Event paid-draft")).not.toHaveTextContent("Paid tickets:");
    expect(screen.queryByRole("link", { name: "set up payouts" })).toBeNull();
  });
});

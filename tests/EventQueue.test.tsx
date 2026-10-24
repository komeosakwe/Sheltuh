// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventQueue from "@/components/admin/EventQueue";
import { eventQueueHref, eventQueueQuery, readEventQueueFilters } from "@/components/admin/event-queue-filters";
import { adminApproveEvent, adminListEvents, adminRejectEvent, adminUnpublishEvent } from "@/lib/api/admin";
import { ApiError } from "@/lib/api/client";
import type { AdminEventRecord } from "@/lib/api/types";
import { adminSummary, FakeAdminSummaryProvider } from "./test-utils/fakeAdminSummary";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/** The URL's query, as a tiny store: router.replace changes it and re-renders whoever reads it. */
const nav = vi.hoisted(() => {
  let params = new URLSearchParams();
  const listeners = new Set<() => void>();
  return {
    get: () => params,
    set(query: string) {
      params = new URLSearchParams(query);
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    replace: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({
  useSearchParams: () => useSyncExternalStore(nav.subscribe, nav.get),
  useRouter: () => ({
    replace: (href: string, options?: unknown) => {
      nav.replace(href, options);
      nav.set(href.split("?")[1] ?? "");
    },
    push: vi.fn(),
  }),
  usePathname: () => "/admin/events",
}));

vi.mock("@/lib/api/admin", () => ({
  adminListEvents: vi.fn(),
  adminApproveEvent: vi.fn(),
  adminRejectEvent: vi.fn(),
  adminUnpublishEvent: vi.fn(),
}));

function ev(overrides: Partial<AdminEventRecord> = {}): AdminEventRecord {
  return {
    organiserId: "org-1",
    eventId: "evt-1",
    slug: "neon-static",
    title: "Neon Static",
    description: "Four bands.",
    category: "live-music",
    venueName: "The Tote",
    venueAddress: "71 Johnston St",
    suburb: "Collingwood",
    startsAt: "2099-03-06T09:00:00.000Z",
    endsAt: "2099-03-06T12:30:00.000Z",
    organiserName: "Static Collective",
    ticketTypes: [],
    ticketingMode: "sheltuh",
    status: "pending_review",
    moderationLog: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    organiserPlatformManaged: false,
    ...overrides,
  };
}

const NEON = ev();
const LANEWAY = ev({ eventId: "evt-2", slug: "laneway", title: "Laneway Nights" });

beforeEach(() => {
  nav.set("");
  nav.replace.mockReset();
  vi.mocked(adminListEvents).mockReset().mockResolvedValue({ items: [NEON] });
  vi.mocked(adminApproveEvent).mockReset();
  vi.mocked(adminRejectEvent).mockReset();
  vi.mocked(adminUnpublishEvent).mockReset();
});
afterEach(cleanup);

function renderQueue(summary = adminSummary()) {
  return render(
    <FakeAuthProvider value={fakeAuthValue({ isAdmin: true })}>
      <FakeAdminSummaryProvider value={{ summary }}>
        <EventQueue />
      </FakeAdminSummaryProvider>
    </FakeAuthProvider>,
  );
}

const statusGroup = () => screen.getByRole("group", { name: "Show events" });

describe("event queue filters (URL)", () => {
  it("reads the status, published view and search from the URL, falling back to waiting for review", () => {
    expect(readEventQueueFilters(new URLSearchParams(""))).toEqual({ status: "pending_review", view: "upcoming", q: "" });
    expect(readEventQueueFilters(new URLSearchParams("status=nope&view=x"))).toEqual({
      status: "pending_review",
      view: "upcoming",
      q: "",
    });
    expect(readEventQueueFilters(new URLSearchParams("status=published&view=door&q=%20neon%20"))).toEqual({
      status: "published",
      view: "door",
      q: "neon",
    });
  });

  it("writes only what isn't the default", () => {
    expect(eventQueueHref({ status: "pending_review", view: "upcoming", q: "" })).toBe("/admin/events");
    expect(eventQueueHref({ status: "draft", view: "door", q: "" })).toBe("/admin/events?status=draft");
    expect(eventQueueHref({ status: "published", view: "all", q: "neon" })).toBe(
      "/admin/events?status=published&view=all&q=neon",
    );
  });

  it("asks for ended events too, except in the published Upcoming and door views; the cursor goes in the object", () => {
    expect(eventQueueQuery({ status: "pending_review", view: "upcoming", q: "" })).toEqual({
      status: "pending_review",
      upcoming: false,
    });
    expect(eventQueueQuery({ status: "published", view: "upcoming", q: "" })).toEqual({ status: "published", upcoming: true });
    expect(eventQueueQuery({ status: "published", view: "all", q: "" })).toEqual({ status: "published", upcoming: false });
    expect(eventQueueQuery({ status: "published", view: "door", q: "x" }, "c1")).toEqual({
      status: "published",
      upcoming: true,
      platformManaged: true,
      q: "x",
      cursor: "c1",
    });
  });
});

describe("EventQueue", () => {
  it("starts on Waiting for review, and a filter changes the URL and what's asked for", async () => {
    renderQueue();
    expect(await screen.findByRole("heading", { level: 3, name: "Neon Static" })).toBeInTheDocument();
    expect(adminListEvents).toHaveBeenCalledWith({ status: "pending_review", upcoming: false }, expect.any(Function));
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Waiting for review (1)");

    fireEvent.click(within(statusGroup()).getByRole("button", { name: "Published" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/events?status=published", { scroll: false });
    await vi.waitFor(() =>
      expect(adminListEvents).toHaveBeenLastCalledWith({ status: "published", upcoming: true }, expect.any(Function)),
    );

    const views = screen.getByRole("group", { name: "Show published events" });
    fireEvent.click(within(views).getByRole("button", { name: "All, past included" }));
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/events?status=published&view=all", { scroll: false });
    await vi.waitFor(() =>
      expect(adminListEvents).toHaveBeenLastCalledWith({ status: "published", upcoming: false }, expect.any(Function)),
    );
    expect(within(views).getByRole("button", { name: "All, past included" })).toHaveAttribute("aria-pressed", "true");
    // A filter the admin chose announces the loaded list (screen readers only).
    expect(await screen.findByText("1 published event.")).toHaveClass("sr-only");
  });

  it("status filters are toggle buttons with plain labels: pressed is announced and marked with the two dots", async () => {
    renderQueue();
    await screen.findByRole("heading", { level: 3, name: "Neon Static" });
    const group = statusGroup();
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Waiting for review",
      "Published",
      "Drafts",
      "Rejected",
    ]);
    const waiting = within(group).getByRole("button", { name: "Waiting for review" });
    expect(waiting).toHaveAttribute("aria-pressed", "true");
    expect(waiting.querySelector("[data-selected-dots]")).not.toBeNull();
    const drafts = within(group).getByRole("button", { name: "Drafts" });
    expect(drafts).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(drafts);
    expect(drafts).toHaveAttribute("aria-pressed", "true");
    expect(drafts.querySelector("[data-selected-dots]")).not.toBeNull();
    await screen.findByRole("heading", { level: 3, name: "Neon Static" });
  });

  it("opens on the URL's filters (a hub link to the door list), with the search in the box", async () => {
    nav.set("status=published&view=door&q=neon");
    vi.mocked(adminListEvents).mockResolvedValue({
      items: [ev({ status: "published", organiserPlatformManaged: true })],
    });
    renderQueue();
    await screen.findByRole("heading", { level: 3, name: "Neon Static" });
    expect(adminListEvents).toHaveBeenCalledWith(
      { status: "published", upcoming: true, platformManaged: true, q: "neon" },
      expect.any(Function),
    );
    expect(screen.getByRole("searchbox", { name: "Search by title or organiser" })).toHaveValue("neon");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Sheltüh-run events, for door check-in");
    expect(screen.getByRole("link", { name: "Door check-in: Neon Static" })).toHaveAttribute(
      "href",
      "/dashboard/evt-1/check-in",
    );
  });

  it("searches by title or organiser on submit, and Clear search drops it", async () => {
    renderQueue();
    await screen.findByRole("heading", { level: 3, name: "Neon Static" });
    const box = screen.getByRole("searchbox", { name: "Search by title or organiser" });
    fireEvent.change(box, { target: { value: "  static  " } });
    fireEvent.submit(box.closest("form") as HTMLFormElement);
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/events?q=static", { scroll: false });
    await vi.waitFor(() =>
      expect(adminListEvents).toHaveBeenLastCalledWith(
        { status: "pending_review", upcoming: false, q: "static" },
        expect.any(Function),
      ),
    );
    expect(await screen.findByText("Matching “static”.")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear search" })[0]);
    expect(nav.replace).toHaveBeenLastCalledWith("/admin/events", { scroll: false });
  });

  it("Approve asks first, saying followers are emailed; Cancel goes back to Approve", async () => {
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: "Approve Neon Static…" }));
    const confirm = screen.getByRole("group", { name: /Publish Neon Static now\?/ });
    expect(confirm).toHaveAccessibleName(/followers are emailed/);
    const cancel = within(confirm).getByRole("button", { name: "Cancel" });
    await vi.waitFor(() => expect(cancel).toHaveFocus());
    expect(adminApproveEvent).not.toHaveBeenCalled();
    fireEvent.click(cancel);
    await vi.waitFor(() => expect(screen.getByRole("button", { name: "Approve Neon Static…" })).toHaveFocus());
  });

  it("after a confirmed approval, says what happened and moves focus to the next event (described by the message)", async () => {
    vi.mocked(adminListEvents).mockResolvedValue({ items: [NEON, LANEWAY] });
    vi.mocked(adminApproveEvent).mockResolvedValue({ ...NEON, status: "published" });
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: "Approve Neon Static…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish and email followers" }));
    });
    expect(adminApproveEvent).toHaveBeenCalledWith("evt-1", expect.any(Function));
    const status = screen.getByText(/^Published Neon Static\./);
    expect(status).toHaveAttribute("role", "status");
    const next = screen.getByRole("heading", { level: 3, name: "Laneway Nights" });
    await vi.waitFor(() => expect(next).toHaveFocus());
    expect(next).toHaveAttribute("aria-describedby", status.id);
    expect(screen.queryByRole("heading", { level: 3, name: "Neon Static" })).toBeNull();
  });

  it("the last event leaving moves focus to the list heading, then shows the empty state", async () => {
    vi.mocked(adminApproveEvent).mockResolvedValue({ ...NEON, status: "published" });
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: "Approve Neon Static…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish and email followers" }));
    });
    const heading = screen.getByRole("heading", { level: 2 });
    await vi.waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveTextContent("Waiting for review (0)");
    expect(screen.getByText("Nothing to review")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create an event" })).toHaveAttribute("href", "/admin/events/new");
  });

  it("Reject needs a reason the organiser will see, then announces the rejection", async () => {
    vi.mocked(adminRejectEvent).mockResolvedValue({ ...NEON, status: "rejected" });
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: "Reject Neon Static…" }));
    const reason = screen.getByRole("textbox", { name: /Reason \(the organiser sees this/ });
    await vi.waitFor(() => expect(reason).toHaveFocus());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    });
    expect(adminRejectEvent).not.toHaveBeenCalled();
    expect(reason).toHaveAccessibleDescription(/Enter a reason\./);
    fireEvent.change(reason, { target: { value: "Add the venue's accessibility details." } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm rejection" }));
    });
    expect(adminRejectEvent).toHaveBeenCalledWith("evt-1", "Add the venue's accessibility details.", expect.any(Function));
    expect(screen.getByText("Rejected Neon Static. The organiser can see your reason.")).toHaveAttribute("role", "status");
  });

  it("Unpublish asks first; an event someone else already changed leaves the list with the reason", async () => {
    nav.set("status=published");
    vi.mocked(adminListEvents).mockResolvedValue({ items: [ev({ status: "published" })] });
    vi.mocked(adminUnpublishEvent).mockRejectedValue(
      new ApiError(409, "This event is no longer published — it may already have been reviewed."),
    );
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: "Unpublish Neon Static…" }));
    expect(screen.getByRole("group", { name: /Unpublish Neon Static\?/ })).toHaveAccessibleName(
      /Tickets already sold stay valid/,
    );
    expect(adminUnpublishEvent).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Yes, unpublish" }));
    });
    expect(screen.getByText(/no longer published .* It’s been taken off this list\./)).toHaveAttribute("role", "status");
  });

  it("a server error is shown in plain words, not the raw message, and the event stays", async () => {
    vi.mocked(adminApproveEvent).mockRejectedValue(new ApiError(500, 'relation "events" does not exist'));
    renderQueue();
    fireEvent.click(await screen.findByRole("button", { name: "Approve Neon Static…" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Publish and email followers" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t publish this event. Try again.");
    expect(screen.queryByText(/relation/)).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Neon Static" })).toBeInTheDocument();
  });

  it("shows each ticket's all-inclusive price first, then the breakdown, and an external event's site", async () => {
    vi.mocked(adminListEvents).mockResolvedValue({
      items: [
        ev({
          ticketTypes: [
            { id: "ga", name: "General", priceCents: 3000, feePolicy: "buyer-pays", quantityAvailable: 120 },
            { id: "vip", name: "VIP", priceCents: 5000, feePolicy: "organiser-absorbs", quantityAvailable: 10 },
            { id: "free", name: "Door list", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 20 },
          ],
        }),
        ev({
          eventId: "evt-3",
          title: "Elsewhere",
          ticketingMode: "external",
          externalTicketUrl: "https://events.humanitix.com/elsewhere",
          externalProvider: "Humanitix",
        }),
      ],
    });
    renderQueue();
    const neon = await screen.findByRole("article", { name: "Neon Static" });
    expect(neon).toHaveTextContent("General: A$31.70 incl. booking fee (A$30 ticket + A$1.70 booking fee) · 120 available");
    expect(neon).toHaveTextContent("VIP: A$50 incl. booking fee (A$50 ticket (booking fee included by organiser))");
    expect(neon).toHaveTextContent("Door list: Free · 20 available");
    const elsewhere = screen.getByRole("article", { name: "Elsewhere" });
    expect(elsewhere).toHaveTextContent("Sold on Humanitix");
    expect(
      within(elsewhere).getByRole("link", { name: "https://events.humanitix.com/elsewhere (opens in a new tab)" }),
    ).toHaveAttribute("target", "_blank");
  });

  it("offers door check-in only for an upcoming Sheltüh-ticketed event of a Sheltüh-run organiser", async () => {
    nav.set("status=published&view=all");
    vi.mocked(adminListEvents).mockResolvedValue({
      items: [
        ev({ status: "published", organiserPlatformManaged: true }),
        ev({ eventId: "evt-4", title: "Own door", status: "published" }),
        ev({
          eventId: "evt-5",
          title: "External run",
          status: "published",
          organiserPlatformManaged: true,
          ticketingMode: "external",
          externalTicketUrl: "https://example.com/t",
        }),
        ev({
          eventId: "evt-6",
          title: "Last year",
          status: "published",
          organiserPlatformManaged: true,
          startsAt: "2020-01-01T09:00:00.000Z",
          endsAt: "2020-01-01T12:00:00.000Z",
        }),
      ],
    });
    renderQueue();
    await screen.findByRole("heading", { level: 3, name: "Neon Static" });
    expect(screen.getAllByRole("link", { name: /^Door check-in/ }).map((l) => l.getAttribute("aria-label"))).toEqual([
      "Door check-in: Neon Static",
    ]);
    expect(screen.getByRole("article", { name: "Neon Static" })).toHaveTextContent("Sheltüh-run organiser");
    expect(screen.getByRole("article", { name: "Last year" })).toHaveTextContent("Ended");
  });

  it("points to the door list when Sheltüh-run events start soon", async () => {
    renderQueue(adminSummary({ doorEvents: { count: 2, windowHours: 24 } }));
    await screen.findByRole("heading", { level: 3, name: "Neon Static" });
    expect(screen.getByText(/2 Sheltüh-run events start in the next 24 hours/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the door check-in list" })).toHaveAttribute(
      "href",
      "/admin/events?status=published&view=door",
    );
  });

  it("has an empty state for each list, and for a search with no match", async () => {
    vi.mocked(adminListEvents).mockResolvedValue({ items: [] });
    nav.set("status=draft");
    renderQueue();
    expect(await screen.findByText("No drafts")).toBeInTheDocument();
    cleanup();
    nav.set("status=published");
    renderQueue();
    expect(await screen.findByText("No upcoming published events")).toBeInTheDocument();
    cleanup();
    nav.set("status=rejected&q=zzz");
    renderQueue();
    expect(await screen.findByText("Nothing matches “zzz”")).toBeInTheDocument();
  });

  it("a failed load says so in plain words and can be tried again", async () => {
    vi.mocked(adminListEvents).mockRejectedValueOnce(new ApiError(503, "upstream timeout"));
    renderQueue();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load events. Try again.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 3, name: "Neon Static" })).toBeInTheDocument();
  });

  it("links each event to the admin editor", async () => {
    renderQueue();
    expect(await screen.findByRole("link", { name: "Edit Neon Static" })).toHaveAttribute("href", "/admin/events/evt-1/edit");
  });

  it("Load more puts the cursor in the query object", async () => {
    vi.mocked(adminListEvents)
      .mockResolvedValueOnce({ items: [NEON], nextCursor: "c2" })
      .mockResolvedValueOnce({ items: [LANEWAY] });
    renderQueue();
    await screen.findByRole("heading", { level: 3, name: "Neon Static" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    });
    expect(adminListEvents).toHaveBeenLastCalledWith(
      { status: "pending_review", upcoming: false, cursor: "c2" },
      expect.any(Function),
    );
    await vi.waitFor(() => expect(screen.getByRole("heading", { level: 3, name: "Laneway Nights" })).toHaveFocus());
  });
});

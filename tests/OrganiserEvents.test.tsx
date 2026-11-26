// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import EventsContent from "@/components/dashboard/events/EventsContent";
import DashboardEventsPage from "@/app/dashboard/events/page";
import { eventsFilterFrom } from "@/lib/organiser-event-card";
import type {
  OrganiserEventCounts,
  OrganiserEventFilter,
  OrganiserEventStage,
  OrganiserEventSummary,
  OrganiserEventSummaryPage,
  OrganiserRecord,
} from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The organiser dashboard's Events tab (Latte's frames 433:7341, 492:14821, 492:15144; organiser-dashboard
 * plan OD-5): the filter chips and their counts, each stage's pill (drawn and undrawn), what the old list
 * said kept on the card (Sheltüh's note, next steps, payouts), the card's other actions, and the undrawn
 * states (no events, an empty filter, loading, error, more than a page).
 */

// The address is the filter's source: useSearchParams reads the jsdom address, as Next keeps it in step
// with history.replaceState.
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));

const getOrganiserEventsSummary = vi.fn();
vi.mock("@/lib/api/organiser-summary", () => ({
  getOrganiserEventsSummary: (...args: unknown[]) => getOrganiserEventsSummary(...args),
}));

type Organiser = Pick<OrganiserRecord, "organiserId" | "status" | "displayName" | "payoutsEnabled" | "logoUrl">;
const APPROVED: Organiser = {
  organiserId: "org-1",
  status: "approved",
  displayName: "Here & Now",
  payoutsEnabled: true,
  logoUrl: "/api/organisers/org-1/logo?v=1",
};
let organiser: Organiser | null = APPROVED;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser, error: null, refetch: vi.fn() }),
}));

// jsdom lays nothing out: give the menu's list a size so it can place itself.
beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) HTMLElement.prototype.scrollIntoView = () => {};
});

const NOW = new Date("2026-11-17T01:00:00.000Z");

function event(id: string, title: string, stage: OrganiserEventStage, overrides: Partial<OrganiserEventSummary> = {}): OrganiserEventSummary {
  return {
    eventId: id,
    title,
    slug: id,
    stage,
    startsAt: "2026-11-21T06:00:00.000Z",
    endsAt: "2026-11-21T10:00:00.000Z",
    timeZone: "Australia/Melbourne",
    state: "VIC",
    venueName: "",
    suburb: "Brunswick",
    ticketingMode: "sheltuh",
    free: false,
    ticketsSold: 0,
    capacity: 80,
    grossCents: 0,
    netCents: 0,
    ...overrides,
  };
}

const COUNTS: OrganiserEventCounts = {
  all: 6,
  live: 3,
  drafts: 2,
  past: 1,
  byStage: { live: 2, sold_out: 1, ended: 1, draft: 2, in_review: 0, changes_needed: 0, unpublished: 0 },
};

/** Latte's six. */
const LATTE: OrganiserEventSummary[] = [
  event("evt-here", "Here & Now", "live", { venueName: "Interconnect Studio", ticketsSold: 86, capacity: 120, grossCents: 223_000, imageUrl: "/x.jpg" }),
  event("evt-open", "Open Studio", "live", { suburb: "Coburg", free: true, ticketsSold: 12, capacity: 40 }),
  event("evt-zine", "Zine Fair", "sold_out", { ticketsSold: 140, capacity: 140, grossCents: 308_000 }),
  event("evt-late", "Late Night Listening", "draft", { suburb: "Northcote" }),
  event("evt-print", "Print Club", "draft", { suburb: "Fitzroy", capacity: 30 }),
  event("evt-summer", "Summer Sessions", "ended", { startsAt: "2026-10-18T06:00:00.000Z", suburb: "Coburg", ticketsSold: 96, capacity: 100, grossCents: 192_000 }),
];

function page(items: OrganiserEventSummary[], overrides: Partial<OrganiserEventSummaryPage> = {}): OrganiserEventSummaryPage {
  return { items, counts: COUNTS, ...overrides };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  getOrganiserEventsSummary.mockReset();
  organiser = APPROVED;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

function tree(auth: AuthContextValue) {
  return (
    <FakeAuthProvider value={auth}>
      <EventsContent />
    </FakeAuthProvider>
  );
}

/** The Events tab at /dashboard/events, or at ?filter= for another filter. */
function renderEvents(filter: OrganiserEventFilter = "all", auth: AuthContextValue = fakeAuthValue()) {
  window.history.replaceState(null, "", filter === "all" ? "/dashboard/events" : `/dashboard/events?filter=${filter}`);
  return render(tree(auth));
}

function card(title: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name: title });
  const article = heading.closest("article");
  if (!article) throw new Error(`no card for ${title}`);
  return article;
}

async function loaded() {
  await waitFor(() => expect(document.querySelectorAll("[data-org-event-card]").length).toBeGreaterThan(0));
}

describe("Events tab — the drawn page", () => {
  it("the title, its line and Create event", async () => {
    getOrganiserEventsSummary.mockResolvedValue(page(LATTE));
    renderEvents();
    expect(screen.getByRole("heading", { level: 1, name: "Your events" })).toBeInTheDocument();
    expect(screen.getByText("Drafts, live and past events.")).toBeInTheDocument();
    await loaded();
    const create = screen.getByRole("link", { name: "Create event" });
    expect(create).toHaveAttribute("href", "/dashboard/new");
    expect(create).not.toHaveAttribute("aria-current");
  });

  it("the chips: All · 6, Live · 3, Drafts · 2, Past · 1, the chosen one pressed", async () => {
    getOrganiserEventsSummary.mockResolvedValue(page(LATTE));
    renderEvents();
    await loaded();
    const group = screen.getByRole("group", { name: "Filter events" });
    const chips = within(group).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["All · 6", "Live · 3", "Drafts · 2", "Past · 1"]);
    // One span inside, so the chip's gap doesn't widen the spaces round the dot.
    expect(chips.every((chip) => chip.children.length === 1)).toBe(true);
    expect(chips.map((chip) => chip.getAttribute("aria-pressed"))).toEqual(["true", "false", "false", "false"]);
    // The dot isn't read: "Live 3".
    expect(chips[1]).toHaveAccessibleName("Live 3");
  });

  it("a chip asks for its filter, shows it, says so, and puts it in the address bar", async () => {
    getOrganiserEventsSummary.mockResolvedValue(page(LATTE));
    getOrganiserEventsSummary.mockResolvedValueOnce(page(LATTE));
    getOrganiserEventsSummary.mockResolvedValueOnce(page(LATTE.filter((e) => e.stage === "draft")));
    renderEvents();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Drafts 2" }));
    expect(screen.getByRole("button", { name: "Drafts 2" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(document.querySelectorAll("[data-org-event-card]")).toHaveLength(2));
    expect(getOrganiserEventsSummary).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ filter: "drafts" }));
    expect(window.location.search).toBe("?filter=drafts");
    expect(screen.getByRole("status")).toHaveTextContent("Showing 2 drafts.");
    fireEvent.click(screen.getByRole("button", { name: "All 6" }));
    expect(window.location.search).toBe("");
  });

  it("opens on the filter it's given (the Overview's drafts bar)", async () => {
    getOrganiserEventsSummary.mockResolvedValue(page(LATTE.filter((e) => e.stage === "draft")));
    renderEvents("drafts");
    await loaded();
    expect(getOrganiserEventsSummary).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ filter: "drafts" }));
    expect(screen.getByRole("button", { name: "Drafts 2" })).toHaveAttribute("aria-pressed", "true");
  });

  it("follows the address when it changes without a reload (the nav's Events link back to All)", async () => {
    getOrganiserEventsSummary.mockImplementation((_token: unknown, options: { filter?: OrganiserEventFilter }) =>
      Promise.resolve(page(options.filter === "drafts" ? LATTE.filter((e) => e.stage === "draft") : LATTE)),
    );
    const view = renderEvents("drafts");
    await waitFor(() => expect(document.querySelectorAll("[data-org-event-card]")).toHaveLength(2));
    // A soft navigation to /dashboard/events: the address changes, the component stays.
    window.history.replaceState(null, "", "/dashboard/events");
    view.rerender(tree(fakeAuthValue()));
    expect(screen.getByRole("button", { name: "All 6" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(document.querySelectorAll("[data-org-event-card]")).toHaveLength(6));
    expect(getOrganiserEventsSummary).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ filter: "all" }));
  });

  it("reads the filter from the address: an unknown one is All, and of two the first counts", async () => {
    expect(eventsFilterFrom("drafts")).toBe("drafts");
    expect(eventsFilterFrom("everything")).toBe("all");
    expect(eventsFilterFrom("")).toBe("all");
    expect(eventsFilterFrom(null)).toBe("all");
    expect(eventsFilterFrom(undefined)).toBe("all");
    expect(eventsFilterFrom(["past", "live"])).toBe("past");
    expect(eventsFilterFrom([])).toBe("all");
    getOrganiserEventsSummary.mockResolvedValue(page(LATTE));
    window.history.replaceState(null, "", "/dashboard/events?filter=nope");
    render(tree(fakeAuthValue()));
    await loaded();
    expect(getOrganiserEventsSummary).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ filter: "all" }));
    cleanup();
    window.history.replaceState(null, "", "/dashboard/events?filter=live&filter=past");
    render(tree(fakeAuthValue()));
    await loaded();
    expect(getOrganiserEventsSummary).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ filter: "live" }));
  });

  it("the page (in its Suspense boundary) shows the tab at the address's filter", async () => {
    getOrganiserEventsSummary.mockResolvedValue(page(LATTE.filter((e) => e.stage === "ended")));
    window.history.replaceState(null, "", "/dashboard/events?filter=past");
    render(<FakeAuthProvider value={fakeAuthValue()}>{DashboardEventsPage()}</FakeAuthProvider>);
    await loaded();
    expect(document.querySelector("[data-page]")).toContainElement(screen.getByRole("heading", { level: 1, name: "Your events" }));
    expect(screen.getByRole("button", { name: "Past 1" })).toHaveAttribute("aria-pressed", "true");
  });

  it("each card: pill, date and place, sales, and Manage → (Continue → for drafts)", async () => {
    getOrganiserEventsSummary.mockResolvedValue(page(LATTE));
    renderEvents();
    await loaded();
    const expected: [string, string, string, string, string][] = [
      ["Here & Now", "Live", "pop-up", "86 / 120 sold · A$2,230", "Manage"],
      ["Open Studio", "Live", "pop-up", "12 / 40 sold · Free", "Manage"],
      ["Zine Fair", "Sold out", "theatre", "140 / 140 sold · A$3,080", "Manage"],
      ["Late Night Listening", "Draft", "neutral", "0 / 80 sold · —", "Continue"],
      ["Print Club", "Draft", "neutral", "0 / 30 sold · —", "Continue"],
      ["Summer Sessions", "Ended", "neutral", "96 / 100 sold · A$1,920", "Manage"],
    ];
    for (const [title, pill, tag, sales, action] of expected) {
      const c = card(title);
      expect(within(c).getByText(pill, { selector: "[data-status-pill]" })).toHaveAttribute("data-tag", tag);
      expect(c).toHaveTextContent(sales);
      expect(within(c).getByRole("link", { name: `${action} ${title}` })).toHaveAttribute(
        "href",
        `/dashboard/${(LATTE.find((e) => e.title === title) as OrganiserEventSummary).eventId}`,
      );
    }
    expect(card("Here & Now")).toHaveTextContent("Sat 21 Nov · Interconnect Studio");
    expect(card("Summer Sessions")).toHaveTextContent("Sun 18 Oct · Coburg");
    // A draft without a photo: the cream block.
    expect(card("Print Club").querySelector("[data-card-image]")).toHaveAttribute("data-card-image", "none");
    // A published event (Live, Sold out, Ended) says it's live and how to change it, as the list did; a draft adds nothing.
    for (const title of ["Here & Now", "Open Studio", "Zine Fair", "Summer Sessions"]) {
      expect(card(title)).toHaveTextContent("Live on Sheltüh. Contact Sheltüh to change it.");
      expect(within(card(title)).getByRole("link", { name: "Contact Sheltüh" })).toHaveAttribute("href", "mailto:support@sheltuh.com.au");
    }
    for (const title of ["Late Night Listening", "Print Club"]) expect(card(title).querySelector("[data-card-details]")).toBeNull();
    // Its "—" is read as words.
    expect(within(card("Print Club")).getByText("—")).toHaveAttribute("aria-hidden", "true");
    expect(within(card("Print Club")).getByText("nothing sold yet")).toHaveClass("sr-only");
  });
});

describe("Events tab — what the list always said, kept on the card", () => {
  it("the undrawn states in the same pill, with Sheltüh's note and the next step", async () => {
    getOrganiserEventsSummary.mockResolvedValue(
      page([
        event("evt-review", "Late Bloom Markets", "in_review"),
        event("evt-back", "Tape Swap", "changes_needed", { rejectionReason: "Add the venue's accessibility details." }),
        event("evt-down", "Rooftop Sessions", "unpublished", { rejectionReason: "The date has passed." }),
        event("evt-down2", "Basement Nights", "unpublished"),
      ]),
    );
    renderEvents();
    await loaded();
    const review = card("Late Bloom Markets");
    expect(within(review).getByText("In review", { selector: "[data-status-pill]" })).toHaveAttribute("data-tag", "fashion");
    expect(review).toHaveTextContent("Sheltüh is checking it before it goes live. You can’t edit it until then.");
    expect(within(review).getByRole("link", { name: "Manage Late Bloom Markets" })).toBeInTheDocument();

    const back = card("Tape Swap");
    expect(within(back).getByText("Changes needed", { selector: "[data-status-pill]" })).toHaveAttribute("data-tag", "theatre");
    expect(back.querySelector("[data-rejection-reason]")).toHaveTextContent("Sheltüh’s note: Add the venue's accessibility details.");
    expect(back).toHaveTextContent("Make the changes Sheltüh asked for, then send it for review again.");
    expect(within(back).getByRole("link", { name: "Continue Tape Swap" })).toHaveAttribute("href", "/dashboard/evt-back");

    const down = card("Rooftop Sessions");
    expect(within(down).getByText("Unpublished", { selector: "[data-status-pill]" })).toHaveAttribute("data-tag", "neutral");
    expect(down.querySelector("[data-rejection-reason]")).toHaveTextContent("Sheltüh’s note: The date has passed.");
    expect(down).toHaveTextContent("Taken off Sheltüh. Edit it, then send it for review.");
    expect(card("Basement Nights").querySelector("[data-rejection-reason]")).toBeNull();
  });

  it("a paid draft while payouts aren't set up: set up payouts first (not a free one, not once they're set up)", async () => {
    organiser = { ...APPROVED, payoutsEnabled: false };
    getOrganiserEventsSummary.mockResolvedValue(
      page([
        event("evt-paid", "dad", "draft"),
        event("evt-free", "Free Jam", "draft", { free: true }),
        event("evt-live", "Neon Static", "live"),
        event("evt-ext", "Elsewhere", "draft", { ticketingMode: "external", capacity: 0 }),
      ]),
    );
    renderEvents();
    await loaded();
    expect(card("dad")).toHaveTextContent("Paid tickets: set up payouts before you publish it.");
    expect(within(card("dad")).getByRole("link", { name: "set up payouts" })).toHaveAttribute("href", "/dashboard/payouts");
    for (const title of ["Free Jam", "Neon Static", "Elsewhere"]) expect(card(title)).not.toHaveTextContent("Paid tickets:");
    // And the page-wide note.
    expect(document.querySelector("[data-payouts-note]")).toHaveTextContent("Set up payouts before publishing paid events.");
    // An event sold elsewhere has no Sheltüh sales and no bar.
    expect(card("Elsewhere")).toHaveTextContent("Tickets sold elsewhere");
    expect(card("Elsewhere").querySelector("[data-progress-bar]")).toBeNull();
  });

  it("no payouts lines once payouts are set up", async () => {
    getOrganiserEventsSummary.mockResolvedValue(page([event("evt-paid", "dad", "draft")]));
    renderEvents();
    await loaded();
    expect(card("dad")).not.toHaveTextContent("Paid tickets:");
    expect(document.querySelector("[data-payouts-note]")).toBeNull();
  });

  it("the card's other actions behind ···, as each applies, named with the event", async () => {
    getOrganiserEventsSummary.mockResolvedValue(
      page([
        event("evt-live", "Neon Static", "live"),
        event("evt-ext", "Elsewhere", "live", { ticketingMode: "external" }),
        event("evt-draft", "dad", "draft"),
      ]),
    );
    renderEvents();
    await loaded();
    const menuOf = (title: string) => {
      fireEvent.click(within(card(title)).getByRole("button", { name: `More for ${title}` }));
      const menu = screen.getByRole("menu", { name: `More for ${title}` });
      const items = within(menu).getAllByRole("menuitem").map((item) => [item.textContent, item.getAttribute("href")]);
      fireEvent.keyDown(menu, { key: "Escape" });
      return items;
    };
    expect(menuOf("Neon Static")).toEqual([
      ["View public page", "/events/evt-live"],
      ["QR code", "/dashboard/events/evt-live/qr"],
      ["Orders", "/dashboard/events/evt-live/orders"],
      ["Analytics", "/dashboard/events/evt-live/analytics"],
      ["Check-in", "/dashboard/evt-live/check-in"],
    ]);
    expect(menuOf("Elsewhere")).toEqual([
      ["View public page", "/events/evt-ext"],
      ["QR code", "/dashboard/events/evt-ext/qr"],
      ["Analytics", "/dashboard/events/evt-ext/analytics"],
    ]);
    expect(menuOf("dad")).toEqual([["Analytics", "/dashboard/events/evt-draft/analytics"]]);
  });

  it("asks for a logo while there isn't one, linking to the Profile page's logo field", async () => {
    organiser = { ...APPROVED, logoUrl: undefined };
    getOrganiserEventsSummary.mockResolvedValue(page(LATTE));
    renderEvents();
    await loaded();
    const prompt = document.querySelector<HTMLElement>("[data-logo-prompt]");
    expect(prompt).toHaveTextContent("Add your logo");
    expect(within(prompt as HTMLElement).getByRole("link", { name: "Add logo" })).toHaveAttribute("href", "/dashboard/profile#logo");
  });
});

describe("Events tab — undrawn states", () => {
  it("no events at all: Create your first event, and no chips or header button", async () => {
    getOrganiserEventsSummary.mockResolvedValue(
      page([], { counts: { all: 0, live: 0, drafts: 0, past: 0, byStage: { ...COUNTS.byStage, live: 0, sold_out: 0, ended: 0, draft: 0 } } }),
    );
    renderEvents();
    expect(await screen.findByRole("heading", { level: 2, name: "No events yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create your first event" })).toHaveAttribute("href", "/dashboard/new");
    expect(screen.queryByRole("link", { name: "Create event" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Filter events" })).toBeNull();
  });

  it("an empty filter says so in its own words", async () => {
    getOrganiserEventsSummary.mockResolvedValue(page([], { counts: { ...COUNTS, past: 0 } }));
    renderEvents("past");
    expect(await screen.findByText("No past events yet.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Filter events" })).toBeInTheDocument();
  });

  it("loading: the loader in place of the grid", () => {
    getOrganiserEventsSummary.mockReturnValue(new Promise(() => {}));
    renderEvents();
    expect(screen.getByRole("progressbar", { name: "Loading your events" })).toBeInTheDocument();
  });

  it("an error is shown (never swallowed), with Try again, which stays (busy) while it loads, then focus goes to the heading", async () => {
    let answer: (value: OrganiserEventSummaryPage) => void = () => {};
    getOrganiserEventsSummary.mockRejectedValueOnce(new Error("Too many requests. Try again in a minute."));
    getOrganiserEventsSummary.mockReturnValueOnce(new Promise<OrganiserEventSummaryPage>((resolve) => (answer = resolve)));
    renderEvents();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your events couldn’t load.");
    expect(alert).toHaveTextContent("Too many requests. Try again in a minute.");
    const again = screen.getByRole("button", { name: "Try again" });
    again.focus();
    fireEvent.click(again);
    expect(screen.getByRole("button", { name: "Try again" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
    answer(page(LATTE));
    await loaded();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Your events" })).toHaveFocus();
  });

  it("more than a page: Load more adds the next (once each), and a failure is shown", async () => {
    getOrganiserEventsSummary
      .mockResolvedValueOnce(page(LATTE.slice(0, 3), { nextCursor: "c1" }))
      .mockResolvedValueOnce(page([LATTE[2], ...LATTE.slice(3, 5)], { nextCursor: "c2" }))
      .mockRejectedValueOnce(new Error("Network down."));
    renderEvents();
    await loaded();
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(document.querySelectorAll("[data-org-event-card]")).toHaveLength(5));
    expect(getOrganiserEventsSummary).toHaveBeenLastCalledWith(expect.any(Function), expect.objectContaining({ filter: "all", cursor: "c1" }));
    // Focus goes to the first new card's link, and how far through is said.
    await waitFor(() => expect(screen.getByRole("link", { name: "Continue Late Night Listening" })).toHaveFocus());
    expect(screen.getByRole("status")).toHaveTextContent("Showing 5 of 6 events.");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Network down.");
  });

  it("signed out, or not an organiser yet: the page says why, and no API call", () => {
    renderEvents("all", fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByText("Sign in to see your events.")).toBeInTheDocument();
    cleanup();
    organiser = { ...APPROVED, status: "pending" };
    renderEvents();
    expect(screen.getByText("Your organiser application is still pending review.")).toBeInTheDocument();
    cleanup();
    renderEvents("all", fakeAuthValue({ configured: false }));
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured in this environment yet.");
    expect(getOrganiserEventsSummary).not.toHaveBeenCalled();
  });
});

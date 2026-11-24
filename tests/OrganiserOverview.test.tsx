// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OverviewContent from "@/components/dashboard/overview/OverviewContent";
import { DashFrameContext } from "@/components/dashboard/ui/DashFrameContext";
import type { OrganiserEventPerformance, OrganiserEventSummary, OrganiserOverview, OrganiserRecord } from "@/lib/api/types";
import type { AuthContextValue } from "@/lib/auth/AuthContext";
import { fakeAuthValue, FakeAuthProvider } from "./test-utils/fakeAuth";

/**
 * The organiser dashboard's Overview (Latte's frames 430:7340, 492:14153, 492:14487; organiser-dashboard
 * plan OD-4): the API's numbers in the drawn places, nothing made up, and the undrawn states (new
 * organiser, loading, error, not an organiser yet).
 */

const getOrganiserOverview = vi.fn();
vi.mock("@/lib/api/organiser-summary", () => ({
  getOrganiserOverview: (...args: unknown[]) => getOrganiserOverview(...args),
}));

type Organiser = Pick<OrganiserRecord, "organiserId" | "status" | "displayName">;
let organiser: Organiser | null = { organiserId: "org-1", status: "approved", displayName: "Here & Now" };
let organiserError: string | null = null;
vi.mock("@/lib/auth/useOrganiser", () => ({
  useOrganiser: () => ({ loading: false, organiser, error: organiserError, refetch: vi.fn() }),
}));

// Tuesday 17 November 2026, midday in Melbourne.
const NOW = new Date("2026-11-17T01:00:00.000Z");

function summary(overrides: Partial<OrganiserEventSummary> = {}): OrganiserEventSummary {
  return {
    eventId: "evt-here",
    title: "Here & Now",
    slug: "here-and-now",
    stage: "live",
    startsAt: "2026-11-21T06:00:00.000Z",
    endsAt: "2026-11-21T10:00:00.000Z",
    timeZone: "Australia/Melbourne",
    state: "VIC",
    venueName: "Interconnect Studio",
    suburb: "Collingwood",
    imageUrl: "/api/events/evt-here/image?v=2",
    ticketingMode: "sheltuh",
    free: false,
    ticketsSold: 86,
    capacity: 120,
    grossCents: 223_000,
    netCents: 210_000,
    ...overrides,
  };
}

function performance(overrides: Partial<OrganiserEventPerformance> = {}): OrganiserEventPerformance {
  return {
    eventId: "evt-here",
    title: "Here & Now",
    stage: "live",
    free: false,
    ticketsSold: 86,
    capacity: 120,
    grossCents: 223_000,
    netCents: 210_000,
    ticketsThisWeek: 23,
    ticketsPreviousWeek: 20,
    deltaPct: 15,
    ...overrides,
  };
}

function overview(overrides: Partial<OrganiserOverview> = {}): OrganiserOverview {
  return {
    thisWeek: {
      range: { from: "2026-11-11", to: "2026-11-17" },
      ticketsSold: 86,
      views: 412,
      viewsUnreliable: false,
      viewsComplete: true,
      newFollowers: 21,
    },
    highlight: summary(),
    upcoming: [
      summary(),
      summary({
        eventId: "evt-open",
        title: "Open Studio",
        slug: "open-studio",
        startsAt: "2026-11-22T00:00:00.000Z",
        venueName: "",
        suburb: "Coburg",
        imageUrl: undefined,
        free: true,
        ticketsSold: 12,
        capacity: 40,
        grossCents: 0,
      }),
    ],
    draftsCount: 2,
    performance: [
      performance(),
      performance({ eventId: "evt-open", title: "Open Studio", free: true, ticketsSold: 12, capacity: 40, grossCents: 0, deltaPct: -10 }),
      performance({ eventId: "evt-zine", title: "Zine Fair", stage: "sold_out", ticketsSold: 140, capacity: 140, grossCents: 308_000, deltaPct: null }),
    ],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  getOrganiserOverview.mockReset();
  organiser = { organiserId: "org-1", status: "approved", displayName: "Here & Now" };
  organiserError = null;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.history.replaceState(null, "", "/");
});

function renderOverview(auth: AuthContextValue = fakeAuthValue(), framed = false) {
  const page = (
    <FakeAuthProvider value={auth}>
      <OverviewContent />
    </FakeAuthProvider>
  );
  render(framed ? <DashFrameContext.Provider value="organiser">{page}</DashFrameContext.Provider> : page);
}

async function loaded() {
  await screen.findByRole("heading", { name: "Upcoming events" });
}

describe("Overview — the drawn page, from the API's numbers", () => {
  it("greets the organiser by name with today's date in Melbourne", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    renderOverview();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back, Here & Now!" })).toBeInTheDocument();
    expect(screen.getByText("Tuesday, 17 November")).toBeInTheDocument();
    await loaded();
    // Latte's grey "3" circle counts nothing defined: not drawn.
    expect(screen.queryByText("3", { exact: true })).toBeNull();
  });

  it("the banner: how much of the event selling now is sold, how many are left before its day, and Share event", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    renderOverview();
    const banner = await screen.findByRole("region", { name: "Nice work!" });
    expect(banner).toHaveAttribute("data-surface", "signal");
    expect(banner).toHaveTextContent("Here & Now is 72% sold — 34 tickets left before Saturday.");
    // The visible words start its name (label in name), then the event.
    expect(within(banner).getByRole("button", { name: "Share event: Here & Now" })).toHaveTextContent("Share event→");
  });

  it("no banner without an event selling now (no stand-in)", async () => {
    getOrganiserOverview.mockResolvedValue(overview({ highlight: null }));
    renderOverview();
    await loaded();
    expect(screen.queryByText("Nice work!")).toBeNull();
    expect(screen.queryByRole("button", { name: /Share event/ })).toBeNull();
  });

  it("this week's three stats: tickets, page views and new followers, with a + when there are any", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    renderOverview();
    const week = await screen.findByRole("region", { name: "This week" });
    const cards = within(week).getAllByText(/^(\+?\d[\d,]*)$/);
    expect(cards.map((card) => card.textContent)).toEqual(["+86", "+412", "+21"]);
    expect(within(week).getByText("Tickets this week")).toBeInTheDocument();
    expect(within(week).getByText("Event page views")).toBeInTheDocument();
    expect(within(week).getByText("New followers")).toBeInTheDocument();
    expect(within(week).queryByText(/weren’t counted/)).toBeNull();
  });

  it("says when some page views weren't counted, rather than passing a low number off as the whole", async () => {
    getOrganiserOverview.mockResolvedValue(
      overview({ thisWeek: { ...overview().thisWeek, viewsUnreliable: true, views: 1204 } }),
    );
    renderOverview();
    const week = await screen.findByRole("region", { name: "This week" });
    expect(within(week).getByText("+1,204")).toBeInTheDocument();
    expect(within(week).getByText("Some of this week’s page views weren’t counted, so the number may be low.")).toBeInTheDocument();
  });

  it("the next two events as cards: title, Live, date and place, sales, and Manage → to the event", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    renderOverview();
    await loaded();
    const cards = document.querySelectorAll<HTMLElement>("[data-org-event-card]");
    expect(cards).toHaveLength(2);
    const [here, open] = cards;
    expect(within(here).getByRole("heading", { level: 3, name: "Here & Now" })).toBeInTheDocument();
    expect(within(here).getByText("Live")).toHaveAttribute("data-tag", "pop-up");
    expect(here).toHaveTextContent("Sat 21 Nov · Interconnect Studio");
    expect(here).toHaveTextContent("86 / 120 sold · A$2,230");
    expect(here.querySelector("img")).toHaveAttribute("alt", "");
    const manage = within(here).getByRole("link", { name: "Manage Here & Now" });
    expect(manage).toHaveAttribute("href", "/dashboard/evt-here");
    expect(manage).toHaveTextContent("Manage→");
    // Free, no venue name (the suburb instead), no photo (the cream block).
    expect(open).toHaveTextContent("Sun 22 Nov · Coburg");
    expect(open).toHaveTextContent("12 / 40 sold · Free");
    expect(open.querySelector("img")).toBeNull();
    expect(open.querySelector("[data-card-image]")).toHaveAttribute("data-card-image", "none");
  });

  it("the drafts bar: how many, and Continue → to the Events tab's drafts; none without drafts", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    renderOverview();
    await loaded();
    const bar = document.querySelector<HTMLElement>("[data-drafts-bar]");
    expect(bar).toHaveTextContent("Drafts · 2 events");
    expect(bar).toHaveAttribute("data-surface", "ink");
    expect(within(bar as HTMLElement).getByRole("link", { name: "Continue your drafts (2 events)" })).toHaveAttribute(
      "href",
      "/dashboard/events?filter=drafts",
    );
    cleanup();
    getOrganiserOverview.mockResolvedValue(overview({ draftsCount: 1 }));
    renderOverview();
    await loaded();
    expect(document.querySelector("[data-drafts-bar]")).toHaveTextContent("Drafts · 1 event");
    cleanup();
    getOrganiserOverview.mockResolvedValue(overview({ draftsCount: 0 }));
    renderOverview();
    await loaded();
    expect(document.querySelector("[data-drafts-bar]")).toBeNull();
  });

  it("Performance: new followers as a count only (no names or See all), and each live event's sales with ↑/↓ on the week before", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    renderOverview();
    const panel = await screen.findByRole("region", { name: "Performance" });
    expect(within(panel).getByRole("heading", { level: 3, name: "New followers (21)" })).toBeInTheDocument();
    expect(within(panel).queryByText("See all")).toBeNull();
    expect(within(panel).queryByText(/Mia T\./)).toBeNull();
    const cards = within(panel).getAllByRole("listitem");
    expect(cards.map((card) => within(card).getByRole("heading", { level: 4 }).textContent)).toEqual(["Here & Now", "Open Studio", "Zine Fair"]);

    const [here, open, zine] = cards;
    expect(here).toHaveTextContent("A$2,230");
    expect(here).toHaveTextContent("86 / 120 sold");
    const up = here.querySelector("[data-status-pill]");
    expect(up).toHaveAttribute("data-tag", "pop-up");
    expect(up).toHaveTextContent("↑ 15%Up 15% on the week before");
    expect(within(here).getByText("↑ 15%")).toHaveAttribute("aria-hidden", "true");

    expect(open).toHaveTextContent("A$0 · free");
    const down = open.querySelector("[data-status-pill]");
    expect(down).toHaveAttribute("data-tag", "theatre");
    expect(down).toHaveTextContent("↓ 10%Down 10% on the week before");

    // Nothing sold the week before: no percentage means anything, so no pill.
    expect(zine).toHaveTextContent("A$3,080");
    expect(zine).toHaveTextContent("140 / 140 sold");
    expect(zine.querySelector("[data-status-pill]")).toBeNull();
  });

  it("money keeps its cents when there are some", async () => {
    getOrganiserOverview.mockResolvedValue(overview({ performance: [performance({ grossCents: 123_456 })] }));
    renderOverview();
    const panel = await screen.findByRole("region", { name: "Performance" });
    expect(panel).toHaveTextContent("A$1,234.56");
  });
});

describe("Overview — a new organiser, loading and errors (not drawn)", () => {
  it("nothing yet: zeros, no banner or drafts bar, an Upcoming card to create an event, and what Performance will show", async () => {
    getOrganiserOverview.mockResolvedValue(
      overview({
        thisWeek: { ...overview().thisWeek, ticketsSold: 0, views: 0, newFollowers: 0 },
        highlight: null,
        upcoming: [],
        draftsCount: 0,
        performance: [],
      }),
    );
    renderOverview();
    const week = await screen.findByRole("region", { name: "This week" });
    expect(within(week).getAllByText("0")).toHaveLength(3);
    expect(screen.queryByText("Nice work!")).toBeNull();
    expect(document.querySelector("[data-drafts-bar]")).toBeNull();
    expect(screen.getByText("No upcoming events")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create event" })).toHaveAttribute("href", "/dashboard/new");
    const panel = screen.getByRole("region", { name: "Performance" });
    expect(within(panel).getByText("New followers (0)")).toBeInTheDocument();
    expect(within(panel).getByText("Your live events show here, with their sales this week.")).toBeInTheDocument();
  });

  it("loading: the greeting, then the loader in place of the numbers", () => {
    getOrganiserOverview.mockReturnValue(new Promise(() => {}));
    renderOverview();
    expect(screen.getByRole("heading", { level: 1, name: "Welcome back, Here & Now!" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Loading your overview" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Performance" })).toBeNull();
  });

  it("an error is shown (never swallowed), with Try again, which loads again", async () => {
    getOrganiserOverview.mockRejectedValueOnce(new Error("Too many requests. Try again in a minute."));
    getOrganiserOverview.mockResolvedValueOnce(overview());
    renderOverview();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your overview couldn’t load.");
    expect(alert).toHaveTextContent("Too many requests. Try again in a minute.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await loaded();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(getOrganiserOverview).toHaveBeenCalledTimes(2);
  });

  it("asks only for the organiser's own overview, with their token", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    const auth = fakeAuthValue();
    renderOverview(auth);
    await loaded();
    expect(getOrganiserOverview).toHaveBeenCalledWith(auth.getAccessToken, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });
});

describe("Overview — the welcome after joining with an organiser link", () => {
  it("says welcome once (?welcome=organiser), focused, and takes the parameter out of the address bar", async () => {
    organiser = { organiserId: "org-1", status: "approved", displayName: "Neon Collective" };
    getOrganiserOverview.mockResolvedValue(overview());
    window.history.replaceState(null, "", "/dashboard?welcome=organiser");
    renderOverview();
    const welcome = await screen.findByText("Welcome to Sheltüh, Neon Collective.");
    const box = welcome.closest("[tabindex='-1']");
    await waitFor(() => expect(box).toHaveFocus());
    expect(screen.getByRole("heading", { level: 1, name: "Welcome, Neon Collective!" })).toBeInTheDocument();
    expect(box).toHaveTextContent(/set up payouts before selling paid tickets\. Your first paid event is checked/);
    expect(within(box as HTMLElement).getByRole("link", { name: "your profile" })).toHaveAttribute("href", "/dashboard/profile");
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("says nothing without it", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    window.history.replaceState(null, "", "/dashboard");
    renderOverview();
    await loaded();
    expect(screen.queryByText(/Welcome to Sheltüh/)).toBeNull();
  });
});

describe("Overview — anyone who isn't an approved organiser", () => {
  it("signed out: Sign in, and no API call", () => {
    renderOverview(fakeAuthValue({ status: "signed-out" }));
    expect(screen.getByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to see your dashboard.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
    expect(getOrganiserOverview).not.toHaveBeenCalled();
  });

  it("demo mode (no accounts here): says so, and no API call", () => {
    renderOverview(fakeAuthValue({ configured: false }));
    expect(screen.getByRole("alert")).toHaveTextContent("Accounts aren’t configured in this environment yet.");
    expect(getOrganiserOverview).not.toHaveBeenCalled();
  });

  it("an applicant: their application's state and the way to it", () => {
    organiser = { organiserId: "org-1", status: "pending", displayName: "Here & Now" };
    renderOverview();
    expect(screen.getByText("Your organiser application is still pending review.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View application" })).toHaveAttribute("href", "/organisers/apply");
    expect(getOrganiserOverview).not.toHaveBeenCalled();
  });

  it("the organiser record failing to load is shown", () => {
    organiser = null;
    organiserError = "Couldn't load your organiser status.";
    renderOverview();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load your organiser status.");
  });
});

describe("Overview — in the frame", () => {
  it("takes back the frame's padding so Performance reaches the panel's edges, and gives it back to its own column", async () => {
    getOrganiserOverview.mockResolvedValue(overview());
    renderOverview(fakeAuthValue(), true);
    await loaded();
    const page = document.querySelector("[data-overview]");
    expect(page).toHaveClass("-mx-4", "md:-mx-6", "-mb-6", "col-lg:flex-row", "col-lg:-mt-14");
    expect(screen.getByRole("region", { name: "Performance" })).toHaveClass("bg-hover", "col-lg:w-100");
  });
});

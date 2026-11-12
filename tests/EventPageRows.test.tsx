// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EventDetailsView from "@/components/EventDetailsView";
import { ApiError } from "@/lib/api/client";
import type { PublicEvent } from "@/lib/api/public-events";
import { sampleEvents } from "@/lib/sample-events";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The event page's organiser profile read and its rows (the owner's event mock, the audit's fix): "by
 * {organiser} · N upcoming", the Organiser card's followers and "✓ Checked", "More from {organiser}" and
 * "Similar nearby"; and the ticket panel's price and one orange action from 1024px.
 */
const api = { getOrganiserProfile: vi.fn(), listPublicEvents: vi.fn() };
vi.mock("@/lib/api/organisers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/organisers")>()),
  getOrganiserProfile: (...a: unknown[]) => api.getOrganiserProfile(...a),
}));
vi.mock("@/lib/api/public-events", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/public-events")>()),
  listPublicEvents: (...a: unknown[]) => api.listPublicEvents(...a),
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
  for (const fn of Object.values(api)) fn.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function sample(slug: string): SheltuhEvent {
  const event = sampleEvents.find((e) => e.slug === slug);
  if (!event) throw new Error(`no sample ${slug}`);
  return event;
}

function asPublic(event: SheltuhEvent, organiserId = "org-1"): PublicEvent {
  return {
    organiserId,
    eventId: event.id,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    venueName: event.venueName,
    venueAddress: event.venueAddress,
    suburb: event.suburb,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    organiserName: event.organiserName,
    ticketTypes: event.ticketTypes,
    ticketingMode: "sheltuh",
    ...(event.coordinates ? { location: { lat: event.coordinates.lat, lng: event.coordinates.lng } } : {}),
  } as PublicEvent;
}

const LIVE: SheltuhEvent = { ...sample("neon-static"), organiserId: "org-1" };

function profile(upcoming: SheltuhEvent[], followerCount: number | null = null) {
  return {
    organiserId: "org-1",
    displayName: LIVE.organiserName,
    description: "",
    categories: [],
    socialLinks: {},
    memberSince: "2026-01",
    followerCount,
    upcomingEvents: upcoming.map((e) => asPublic(e)),
    recentEvents: [],
  };
}

describe("the organiser's profile read (live)", () => {
  it("says how many upcoming events they have, their followers in short form and Checked, and More from without this event", async () => {
    const others = [sample("fitzroy-poetry-and-noise"), sample("paper-moon-ceramics-lab")];
    api.getOrganiserProfile.mockResolvedValue(profile([LIVE, ...others], 1240));
    api.listPublicEvents.mockResolvedValue({ items: [] });
    render(<EventDetailsView event={LIVE} demo={false} />);

    const facts = document.querySelector("[data-event-facts]") as HTMLElement;
    await waitFor(() => expect(within(facts).getByText(/3 upcoming/)).toBeInTheDocument());
    expect(api.getOrganiserProfile).toHaveBeenCalledTimes(1);
    expect(api.getOrganiserProfile).toHaveBeenCalledWith("org-1");

    const host = screen.getByRole("region", { name: "Organiser" });
    expect(within(host).getByText("1.2K followers · ✓ Checked")).toHaveClass("mono-s", "uppercase");

    const more = screen.getByRole("region", { name: `More from ${LIVE.organiserName}` });
    const titles = within(more).getAllByRole("link").map((a) => a.textContent);
    expect(titles).toEqual(expect.arrayContaining(others.map((e) => e.title)));
    expect(titles).not.toContain(LIVE.title);
    expect(within(more).getByRole("link", { name: `See all events by ${LIVE.organiserName}` })).toHaveAttribute("href", "/organisers/org-1");
  });

  it("hides followers under ten (the API sends null), and More from when this is their only event", async () => {
    api.getOrganiserProfile.mockResolvedValue(profile([LIVE], null));
    api.listPublicEvents.mockResolvedValue({ items: [] });
    render(<EventDetailsView event={LIVE} demo={false} />);
    const host = screen.getByRole("region", { name: "Organiser" });
    await waitFor(() => expect(within(host).getByText("✓ Checked")).toBeInTheDocument());
    expect(host).not.toHaveTextContent(/followers/);
    expect(screen.queryByRole("region", { name: /^More from/ })).toBeNull();
  });

  it("shows nothing extra when the organiser has no public profile (404)", async () => {
    api.getOrganiserProfile.mockRejectedValue(new ApiError(404, "Not found."));
    api.listPublicEvents.mockResolvedValue({ items: [] });
    render(<EventDetailsView event={LIVE} demo={false} />);
    await waitFor(() => expect(api.getOrganiserProfile).toHaveBeenCalled());
    await act(async () => {});
    expect(document.querySelector("[data-organiser-upcoming]")).toBeNull();
    expect(screen.getByRole("region", { name: "Organiser" })).not.toHaveTextContent("Checked");
    expect(screen.queryByRole("region", { name: /^More from/ })).toBeNull();
  });

  it("says a failed read, with Try again that keeps focus and reads again", async () => {
    api.getOrganiserProfile.mockRejectedValueOnce(new ApiError(500, "boom"));
    api.listPublicEvents.mockResolvedValue({ items: [] });
    render(<EventDetailsView event={LIVE} demo={false} />);
    const more = await screen.findByRole("region", { name: `More from ${LIVE.organiserName}` });
    expect(more).toHaveTextContent("Couldn’t load these events.");
    api.getOrganiserProfile.mockResolvedValue(profile([LIVE, sample("fitzroy-poetry-and-noise")]));
    const retry = within(more).getByRole("button", { name: "Try again" });
    retry.focus();
    fireEvent.click(retry);
    await waitFor(() => expect(within(screen.getByRole("region", { name: /^More from/ })).getByRole("link", { name: "Fitzroy Poetry & Noise" })).toBeInTheDocument());
    expect(api.getOrganiserProfile).toHaveBeenCalledTimes(2);
  });
});

describe("Similar nearby", () => {
  it("live: the category's upcoming events within 25 km, without this event or the organiser's own, with See all", async () => {
    api.getOrganiserProfile.mockResolvedValue(profile([LIVE]));
    const near = sample("fitzroy-poetry-and-noise"); // live music, Fitzroy: about 1 km away
    const sameOrganiser = { ...sample("thornbury-dub-session") };
    api.listPublicEvents.mockResolvedValue({
      items: [asPublic(LIVE), asPublic(near, "org-2"), asPublic(sameOrganiser, "org-1"), asPublic(sample("brunswick-zine-fair"), "org-3")],
    });
    render(<EventDetailsView event={LIVE} demo={false} />);
    const row = await screen.findByRole("region", { name: "Similar nearby" });
    expect(api.listPublicEvents).toHaveBeenCalledWith({ category: "live-music", upcoming: true, limit: 50 });
    expect(within(row).getByText("Live music · near Collingwood")).toHaveClass("mono-s", "uppercase");
    const titles = within(row).getAllByRole("link").map((a) => a.textContent);
    expect(titles).toContain(near.title);
    expect(titles).not.toContain(LIVE.title);
    expect(titles).not.toContain(sameOrganiser.title);
    expect(titles).not.toContain("Brunswick Zine Fair");
    expect(within(row).getByRole("link", { name: "See all Live music events" })).toHaveAttribute("href", "/events?category=live-music");
  });

  // CodeRabbit (PR 43): the soonest 50 of a category can all be far away; a near one on a later page still counts.
  it("reads on through the category's pages while the row isn't full, up to 4 pages", async () => {
    api.getOrganiserProfile.mockResolvedValue(profile([LIVE]));
    const near = sample("fitzroy-poetry-and-noise");
    const far = { ...asPublic(LIVE, "org-9"), eventId: "far", slug: "far", title: "Far Gig", suburb: "Perth", location: { lat: -31.95, lng: 115.86 } };
    api.listPublicEvents
      .mockResolvedValueOnce({ items: [asPublic(LIVE), far], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [asPublic(near, "org-2")], nextCursor: "c2" })
      .mockResolvedValue({ items: [], nextCursor: undefined });
    render(<EventDetailsView event={LIVE} demo={false} />);
    const row = await screen.findByRole("region", { name: "Similar nearby" });
    expect(within(row).getByRole("link", { name: near.title })).toBeInTheDocument();
    expect(within(row).queryByRole("link", { name: "Far Gig" })).toBeNull();
    expect(api.listPublicEvents.mock.calls.map(([args]) => args)).toEqual([
      { category: "live-music", upcoming: true, limit: 50, cursor: undefined },
      { category: "live-music", upcoming: true, limit: 50, cursor: "c1" },
      { category: "live-music", upcoming: true, limit: 50, cursor: "c2" },
    ]);
  });

  it("stops after 4 pages, and shows nothing when none of them is near", async () => {
    api.getOrganiserProfile.mockResolvedValue(profile([LIVE]));
    let n = 0;
    api.listPublicEvents.mockImplementation(async () => ({ items: [asPublic(LIVE)], nextCursor: `c${++n}` }));
    render(<EventDetailsView event={LIVE} demo={false} />);
    await waitFor(() => expect(api.listPublicEvents).toHaveBeenCalledTimes(4));
    await act(async () => {});
    expect(api.listPublicEvents).toHaveBeenCalledTimes(4);
    expect(screen.queryByRole("region", { name: "Similar nearby" })).toBeNull();
  });

  it("is hidden when nothing is near", async () => {
    api.getOrganiserProfile.mockResolvedValue(profile([LIVE]));
    api.listPublicEvents.mockResolvedValue({ items: [asPublic(LIVE)] });
    render(<EventDetailsView event={LIVE} demo={false} />);
    await waitFor(() => expect(api.listPublicEvents).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("region", { name: "Similar nearby" })).toBeNull();
  });

  it("demo: from the samples, with no API call at all", async () => {
    render(<EventDetailsView event={sample("neon-static")} demo />);
    const row = await screen.findByRole("region", { name: "Similar nearby" });
    expect(within(row).getByRole("link", { name: "Fitzroy Poetry & Noise" })).toBeInTheDocument();
    // The sample organiser's other events (Static Collective has more than one in the samples, or none).
    expect(api.getOrganiserProfile).not.toHaveBeenCalled();
    expect(api.listPublicEvents).not.toHaveBeenCalled();
  });
});

describe("the editor's preview", () => {
  it("makes no request for the organiser or similar events, and shows neither row", async () => {
    render(<EventDetailsView event={LIVE} demo={false} preview={{ missing: { title: false, description: false, when: false, where: false } }} />);
    await act(async () => {});
    expect(api.getOrganiserProfile).not.toHaveBeenCalled();
    expect(api.listPublicEvents).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /^More from|Similar nearby/ })).toBeNull();
  });
});

describe("the ticket panel's price and action (from 1024px)", () => {
  it("is the all-inclusive From price and Buy tickets to the tickets, hidden below lg where the bar has them", () => {
    api.getOrganiserProfile.mockResolvedValue(profile([LIVE]));
    api.listPublicEvents.mockResolvedValue({ items: [] });
    const { container } = render(<EventDetailsView event={sample("neon-static")} demo />);
    const panel = container.querySelector<HTMLElement>("[data-buy-panel]");
    if (!panel) throw new Error("no panel price");
    expect(panel.parentElement).toHaveClass("max-lg:hidden");
    expect(within(panel).getByText("From A$32.30")).toBeInTheDocument();
    expect(within(panel).getByText("incl. booking fee")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Buy tickets" })).toHaveAttribute("href", "#tickets");
    expect(within(panel).getByRole("link", { name: "Buy tickets" })).toHaveClass("btn-signal", "btn-lg");
    // The panel sticks under the header from lg.
    expect(container.querySelector("[data-ticket-panel]")).toHaveClass("lg:sticky");
    // The bar's button is sentence case, with the rules' black label (no capitalize, no white text).
    const bar = container.querySelector<HTMLElement>("[data-buy-bar]");
    const barLink = bar && within(bar).getByRole("link", { name: "Buy tickets" });
    expect(barLink?.className).not.toMatch(/capitalize|text-paper/);
  });

  it("a seated event: its price and Choose seats to the seat page", () => {
    const seated = sampleEvents.find((e) => e.seating && !e.soldOut);
    if (!seated) throw new Error("no seated sample");
    const { container } = render(<EventDetailsView event={seated} demo />);
    const panel = container.querySelector<HTMLElement>("[data-ticket-panel]");
    if (!panel) throw new Error("no panel");
    expect(within(panel).getByRole("link", { name: "Choose seats" })).toHaveAttribute("href", `/events/${seated.slug}/seats`);
  });

  it("an external event: the organiser's price and the outbound link, orange; the tickets section's is black", () => {
    const external = sampleEvents.find((e) => e.ticketingMode === "external" && e.externalTicketUrl && e.externalPriceFromCents);
    if (!external) throw new Error("no external sample");
    const { container } = render(<EventDetailsView event={external} demo />);
    const panel = container.querySelector<HTMLElement>("[data-ticket-panel]");
    if (!panel) throw new Error("no panel");
    expect(within(panel).getByText("Price set by the organiser.")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Buy tickets (opens in a new tab)" })).toHaveClass("btn-signal");
    const tickets = container.querySelector<HTMLElement>("#tickets");
    if (!tickets) throw new Error("no tickets");
    expect(within(tickets).getByRole("link", { name: "Buy tickets (opens in a new tab)" })).toHaveClass("btn-solid");
  });

  it("sold out: Join waitlist; ended: no price or action, Save and Share stay", () => {
    const soldOut = sample("dead-letter-office");
    const { container, unmount } = render(<EventDetailsView event={soldOut} demo />);
    let panel = container.querySelector<HTMLElement>("[data-ticket-panel]") as HTMLElement;
    expect(within(panel).getByText("Sold out")).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Join waitlist" })).toHaveAttribute("href", "#tickets");
    unmount();
    vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
    const ended = render(<EventDetailsView event={sample("neon-static")} demo />);
    panel = ended.container.querySelector<HTMLElement>("[data-ticket-panel]") as HTMLElement;
    expect(panel.querySelector("[data-buy-panel], .btn-signal")).toBeNull();
    expect(within(panel).getByRole("button", { name: "Add to calendar" })).toBeInTheDocument();
  });
});

describe("the tags beside the title", () => {
  it("the category, and a short age tag only when the organiser gave one", () => {
    const { container, unmount } = render(<EventDetailsView event={{ ...sample("neon-static"), ageRestriction: "18+. Licensed venue." }} demo />);
    const tags = container.querySelector<HTMLElement>("[data-event-tags]") as HTMLElement;
    expect([...tags.children].map((t) => t.textContent)).toEqual(["Live music", "Age restriction: 18+"]);
    expect(tags.querySelector(".sr-only")).toHaveTextContent("Age restriction:");
    unmount();
    const none = render(<EventDetailsView event={{ ...sample("neon-static"), ageRestriction: undefined }} demo />);
    const only = none.container.querySelector<HTMLElement>("[data-event-tags]") as HTMLElement;
    expect([...only.children].map((t) => t.textContent)).toEqual(["Live music"]);
    expect(only).not.toHaveTextContent(/Editor/);
  });
});

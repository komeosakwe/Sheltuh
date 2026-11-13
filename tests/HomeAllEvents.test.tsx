// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import HomeAllEvents, { ALL_EVENTS_PAGE, ALL_EVENTS_PAGE_PHONE, HOME_GRID } from "@/components/home/HomeAllEvents";
import { NO_HOME_FILTERS, type HomeFilters } from "@/lib/home-filters";
import type { SheltuhEvent } from "@/lib/types";

/** All events (the proposal, redesign PR 3): the home's full list, its filters and Show more. */

// Wed 21 Oct 2026, 12:00 AEDT.
const NOW = new Date("2026-10-21T01:00:00.000Z");

function event(id: string, startsAt: string, priceCents = 3000, category: SheltuhEvent["category"] = "art"): SheltuhEvent {
  return {
    id,
    slug: id,
    title: `Event ${id}`,
    description: "d",
    category,
    suburb: "Fitzroy",
    venueName: "Venue",
    venueAddress: "1 St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

const TONIGHT = event("tonight", "2026-10-21T09:00:00.000Z", 1000, "live-music");
const SAT = event("sat", "2026-10-24T08:00:00.000Z", 0, "theatre");
const LATER = Array.from({ length: 14 }, (_, i) => event(`l${i}`, `2026-11-${String(i + 1).padStart(2, "0")}T08:00:00.000Z`, 6000));
const EVENTS = [TONIGHT, SAT, ...LATER];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function Harness({ events = EVENTS, complete = true }: { events?: SheltuhEvent[]; complete?: boolean }) {
  const [filters, setFilters] = useState<HomeFilters>(NO_HOME_FILTERS);
  return (
    <HomeAllEvents id="home-all-events" events={events} complete={complete} mode="demo" now={NOW} filters={filters} onFiltersChange={setFilters} />
  );
}

const titles = () => within(screen.getByRole("list", { name: "All events" })).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
const status = () => within(screen.getByRole("region", { name: "All events" })).getByRole("status");
/** The count is set a moment after the status is cleared. */
const announced = () => act(() => new Promise((r) => setTimeout(r, 150)));

describe("HomeAllEvents", () => {
  it("is a section with the dotted head, its whole count when complete, See all events, the three filters and the grid", () => {
    render(<Harness />);
    const section = screen.getByRole("region", { name: "All events" });
    expect(section).toHaveAttribute("id", "home-all-events");
    expect(within(section).getByText(`${EVENTS.length} upcoming · Across Australia`)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "See all events" })).toHaveAttribute("href", "/events");
    const form = within(section).getByRole("form", { name: "Filter events" });
    // Price, Category and Date only: Distance, Accessibility and Sort are deferred (no data behind them).
    expect(within(form).getAllByRole("combobox")).toHaveLength(3);
    expect(within(form).getByRole("combobox", { name: "Price" })).toHaveValue("all");
    expect(within(form).getByRole("combobox", { name: "Category" })).toHaveValue("all");
    expect(within(form).getByRole("combobox", { name: "Date" })).toHaveValue("all");
    expect(screen.queryByRole("combobox", { name: /Sort|Distance|Accessibility/ })).toBeNull();
    // One column, two from 640px, three from 1024px, four from 1280px: never narrower than the card's one-line foot.
    expect(HOME_GRID).toBe("grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 md:gap-x-6 lg:grid-cols-3 lg:gap-x-8 xl:grid-cols-4");
    expect(screen.getByRole("list", { name: "All events" })).toHaveClass(...HOME_GRID.split(" "));
    // Nothing is announced until a filter changes.
    expect(status()).toHaveTextContent("");
  });

  it("never states a count it can't vouch for: 'Across Australia' alone when the load wasn't complete", () => {
    render(<Harness complete={false} />);
    expect(screen.getByRole("region", { name: "All events" }).querySelector("[data-section-note]")).toHaveTextContent(/^Across Australia$/);
  });

  it("when the home didn't load every event: See all events at the bottom too, once everything loaded is shown", () => {
    render(<Harness complete={false} />);
    const section = screen.getByRole("region", { name: "All events" });
    // While there's more to show, Show more is the way on.
    expect(within(section).getAllByRole("link", { name: "See all events" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show more events" }));
    const links = within(section).getAllByRole("link", { name: "See all events" });
    expect(links).toHaveLength(2);
    expect(links[1]).toHaveAttribute("href", "/events");
    cleanup();
    // A complete load needs no second link.
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Show more events" }));
    expect(screen.getAllByRole("link", { name: "See all events" })).toHaveLength(1);
  });

  it("puts the filters in one sideways row on phones, wrapping from 640px", () => {
    render(<Harness />);
    expect(screen.getByRole("form", { name: "Filter events" })).toHaveClass("flex-nowrap", "overflow-x-auto", "sm:flex-wrap", "sm:overflow-visible");
  });

  it(`shows ${ALL_EVENTS_PAGE} cards, then Show more events adds as many again, moving focus to the first new card`, () => {
    render(<Harness />);
    expect(titles()).toEqual(EVENTS.slice(0, ALL_EVENTS_PAGE).map((e) => e.title));
    fireEvent.click(screen.getByRole("button", { name: "Show more events" }));
    expect(titles()).toEqual(EVENTS.map((e) => e.title));
    expect(screen.getByRole("link", { name: EVENTS[ALL_EVENTS_PAGE].title })).toHaveFocus();
    // Everything shown: no button.
    expect(screen.queryByRole("button", { name: "Show more events" })).toBeNull();
  });

  it(`on a phone, ${ALL_EVENTS_PAGE_PHONE} at a time`, () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query.includes("max-width"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    render(<Harness />);
    expect(titles()).toHaveLength(ALL_EVENTS_PAGE_PHONE);
    fireEvent.click(screen.getByRole("button", { name: "Show more events" }));
    expect(titles()).toHaveLength(2 * ALL_EVENTS_PAGE_PHONE);
  });

  it("filters by price (Free, Under A$25 all-inclusive), category and date (Tonight, This weekend), announces the count, and resets", async () => {
    render(<Harness />);
    const price = screen.getByRole("combobox", { name: "Price" });
    expect(within(price).getAllByRole("option").map((o) => o.textContent)).toEqual(["Any price", "Free", "Under A$25"]);
    fireEvent.change(price, { target: { value: "free" } });
    expect(titles()).toEqual(["Event sat"]);
    await announced();
    expect(status()).toHaveTextContent(/^1 event matches$/);
    expect(price.closest("[data-filter-dropdown]")?.querySelector("select")).toHaveAttribute("data-active");
    fireEvent.change(price, { target: { value: "under25" } });
    // A$10 plus the booking fee is still under A$25; the free one is too; A$60 isn't.
    expect(titles()).toEqual(["Event tonight", "Event sat"]);
    // Cleared first, then set: the same words twice in a row are still read out.
    expect(status()).toHaveTextContent(/^$/);
    await announced();
    expect(status()).toHaveTextContent(/^2 events match$/);

    fireEvent.change(price, { target: { value: "all" } });
    const date = screen.getByRole("combobox", { name: "Date" });
    expect(within(date).getAllByRole("option").map((o) => o.textContent)).toEqual(["Any date", "Tonight", "This weekend"]);
    fireEvent.change(date, { target: { value: "tonight" } });
    expect(titles()).toEqual(["Event tonight"]);
    fireEvent.change(date, { target: { value: "weekend" } });
    expect(titles()).toEqual(["Event sat"]);

    fireEvent.change(date, { target: { value: "all" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "live-music" } });
    expect(titles()).toEqual(["Event tonight"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    expect(titles()).toHaveLength(ALL_EVENTS_PAGE);
    // The button has gone: focus moves to the section's heading.
    expect(screen.getByRole("heading", { level: 2, name: "All events" })).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Reset filters" })).toBeNull();
  });

  it("with no match: the empty state and Reset filters (focus to the heading after), and no Show more", async () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "pop-up" } });
    expect(screen.getByText("No events match your filters")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "All events" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show more events" })).toBeNull();
    await announced();
    expect(status()).toHaveTextContent(/^0 events match$/);
    const resets = screen.getAllByRole("button", { name: "Reset filters" });
    fireEvent.click(resets[resets.length - 1]);
    expect(titles()).toHaveLength(ALL_EVENTS_PAGE);
    expect(screen.getByRole("heading", { level: 2, name: "All events" })).toHaveFocus();
  });

  // CodeRabbit (PR 43): the home loads up to its own limit, so on an incomplete load an event
  // that matches may be on a page it didn't read. Neither the status nor the empty state says otherwise.
  it("on an incomplete load, counts only the loaded events and its empty state says so, with the full list's link", async () => {
    render(<Harness complete={false} />);
    const section = screen.getByRole("region", { name: "All events" });
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "theatre" } });
    await announced();
    expect(status()).toHaveTextContent(/^1 of the loaded events matches$/);
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "art" } });
    await announced();
    expect(status()).toHaveTextContent(new RegExp(`^${LATER.length} of the loaded events match$`));

    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "pop-up" } });
    expect(screen.queryByText("No events match your filters")).toBeNull();
    expect(within(section).getByText("None of the events loaded here match your filters")).toBeInTheDocument();
    expect(within(section).getByText("The full list has more events, and some of them may match.")).toBeInTheDocument();
    await announced();
    expect(status()).toHaveTextContent(/^0 of the loaded events match$/);
    // The full list from the empty state (and the head's): one beside Reset filters, no second at the bottom.
    const links = within(section).getAllByRole("link", { name: "See all events" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/events");
    expect(within(section).getAllByRole("button", { name: "Reset filters" })).toHaveLength(2);
  });

  it("starts again from the first page when a filter changes", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Show more events" }));
    expect(titles()).toHaveLength(EVENTS.length);
    fireEvent.change(screen.getByRole("combobox", { name: "Price" }), { target: { value: "all" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Category" }), { target: { value: "art" } });
    expect(titles()).toHaveLength(ALL_EVENTS_PAGE);
  });

  it("prices on the cards are all-inclusive A$ labels, never controls", () => {
    const { container } = render(<Harness />);
    const prices = Array.from(container.querySelectorAll("[data-price-tag='signal']"));
    expect(prices.length).toBeGreaterThan(0);
    for (const price of prices) {
      expect(price).toHaveTextContent(/^(?:From )?A\$[\d.]+$|^Free$/);
      expect(price.closest("button")).toBeNull();
    }
  });
});

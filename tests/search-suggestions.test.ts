import { describe, expect, it } from "vitest";
import { HOME_CATEGORIES } from "@/components/home/CategoryRow";
import { SUGGESTED_EVENTS_MAX, searchSuggestionGroups } from "@/lib/search-suggestions";
import type { SheltuhEvent } from "@/lib/types";

function event(id: string, startsAt: string): SheltuhEvent {
  return {
    id,
    slug: `slug-${id}`,
    title: `Event ${id}`,
    description: "d",
    category: "art",
    suburb: "Fitzroy",
    state: "VIC",
    timeZone: "Australia/Melbourne",
    venueName: "The Hall",
    venueAddress: "1 St",
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3 * 3600_000).toISOString(),
    organiserId: "org-1",
    organiserName: "Org",
    poster: { pattern: "rings", background: "#000000", primary: "#ffffff", secondary: "#ff4800" },
    ticketTypes: [{ id: `${id}-t`, name: "GA", priceCents: 0, feePolicy: "buyer-pays", quantityAvailable: 10 }],
  };
}

const NOW = new Date("2026-11-13T00:00:00Z");

describe("searchSuggestionGroups", () => {
  it("suggests every home category, in the chips' own words, each opening /events filtered to it", () => {
    const [categories, ...rest] = searchSuggestionGroups(HOME_CATEGORIES);
    expect(rest).toEqual([]);
    expect(categories.title).toBe("Categories");
    expect(categories.options.map((option) => option.label)).toEqual(["Live music", "Art", "Workshops", "Pop-ups", "Theatre"]);
    expect(categories.options.map((option) => option.href)).toEqual([
      "/events?category=live-music",
      "/events?category=art",
      "/events?category=workshop",
      "/events?category=pop-up",
      "/events?category=theatre",
    ]);
  });

  it("adds the first few loaded events under “Coming up”, in the page's order, each opening its page", () => {
    const events = ["a", "b", "c", "d", "e"].map((id, index) => event(id, `2026-11-${20 + index}T09:00:00Z`));
    const groups = searchSuggestionGroups(HOME_CATEGORIES, { events, now: NOW });
    const coming = groups[1];
    expect(coming.title).toBe("Coming up");
    expect(coming.options).toHaveLength(SUGGESTED_EVENTS_MAX);
    expect(coming.options.map((option) => [option.label, option.href])).toEqual([
      ["Event a", "/events/slug-a"],
      ["Event b", "/events/slug-b"],
      ["Event c", "/events/slug-c"],
    ]);
    // The card's own date line: date, time and place.
    const first = coming.options[0];
    expect(first.kind === "event" && first.detail).toBe("Fri 20 Nov · 8pm · Fitzroy, VIC");
    // Every option has its own key (the listbox's option ids).
    const keys = groups.flatMap((group) => group.options.map((option) => option.key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("leaves “Coming up” out when there are no events", () => {
    expect(searchSuggestionGroups(HOME_CATEGORIES, { events: [], now: NOW }).map((group) => group.key)).toEqual(["categories"]);
  });
});

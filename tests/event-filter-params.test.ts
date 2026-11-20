import { describe, expect, it } from "vitest";
import { eventFilterHref, parseEventFilterParams } from "@/lib/event-filter-params";
import { NO_HOME_FILTERS, seeAllEventsLink } from "@/lib/home-filters";

describe("parseEventFilterParams (/events?category=&pricing=)", () => {
  it("keeps a known category and pricing option", () => {
    expect(parseEventFilterParams({ category: "art", pricing: "free" })).toEqual({ category: "art", pricing: "free" });
    expect(parseEventFilterParams({ category: "pop-up", pricing: "paid" })).toEqual({ category: "pop-up", pricing: "paid" });
  });

  it("falls back to all for anything unknown or missing", () => {
    expect(parseEventFilterParams({})).toEqual({ category: "all", pricing: "all" });
    expect(parseEventFilterParams({ category: "nightlife", pricing: "cheap" })).toEqual({ category: "all", pricing: "all" });
    expect(parseEventFilterParams({ category: "ART", pricing: "" })).toEqual({ category: "all", pricing: "all" });
    expect(parseEventFilterParams({ category: "all", pricing: "all" })).toEqual({ category: "all", pricing: "all" });
  });

  it("uses only the first value of a repeated param", () => {
    expect(parseEventFilterParams({ category: ["theatre", "art"], pricing: ["bogus", "free"] })).toEqual({
      category: "theatre",
      pricing: "all",
    });
  });
});

describe("eventFilterHref (the /events link with filters)", () => {
  it("is plain /events with no filters, and parses back to the same filters", () => {
    expect(eventFilterHref({ category: "all", pricing: "all" })).toBe("/events");
    for (const filters of [
      { category: "live-music", pricing: "free" },
      { category: "art", pricing: "all" },
      { category: "all", pricing: "paid" },
    ] as const) {
      const href = eventFilterHref(filters);
      const params = Object.fromEntries(new URL(href, "https://sheltuh.com.au").searchParams);
      expect(parseEventFilterParams(params)).toEqual(filters);
    }
    expect(eventFilterHref({ category: "live-music", pricing: "free" })).toBe("/events?category=live-music&pricing=free");
  });
});

describe("seeAllEventsLink (the home's All events to /events)", () => {
  it("carries the category and Free, names the category, and leaves out Under A$25 and the dates", () => {
    expect(seeAllEventsLink(NO_HOME_FILTERS)).toEqual({ href: "/events", label: "See all events" });
    expect(seeAllEventsLink({ category: "live-music", price: "all", date: "all" })).toEqual({
      href: "/events?category=live-music",
      label: "See all live music events",
    });
    expect(seeAllEventsLink({ category: "pop-up", price: "free", date: "tonight" })).toEqual({
      href: "/events?category=pop-up&pricing=free",
      label: "See all pop-up events",
    });
    expect(seeAllEventsLink({ category: "all", price: "under25", date: "weekend" })).toEqual({ href: "/events", label: "See all events" });
    expect(seeAllEventsLink({ category: "all", price: "free", date: "all" })).toEqual({ href: "/events?pricing=free", label: "See all events" });
  });
});

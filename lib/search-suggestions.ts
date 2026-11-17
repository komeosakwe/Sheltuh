import { cardMetaParts } from "./event-card";
import type { EventCategory, SheltuhEvent } from "./types";

/** A category's listing: /events filtered to it (the search suggestions' and the home's scene cards' one URL). */
export function categoryHref(category: EventCategory): string {
  return `/events?category=${encodeURIComponent(category)}`;
}

/** At most this many events under "Coming up". */
export const SUGGESTED_EVENTS_MAX = 3;

/** A suggestion under the empty search field: a category to browse, or an event to open. */
export type SearchSuggestion =
  | { kind: "category"; key: string; label: string; category: EventCategory; href: string }
  | { kind: "event"; key: string; label: string; detail: string; href: string };

export interface SearchSuggestionGroup {
  key: "categories" | "events";
  title: string;
  options: SearchSuggestion[];
}

/**
 * What the empty search field suggests (the owner's "suggest events to search up", Nov 2026):
 * "Categories", each opening /events filtered to it (the words alone wouldn't find them: a search
 * reads titles, venues and places, not categories), then "Coming up", the first few of `events`
 * (already upcoming and in the order the page lists them; the home puts the saved suburb's state
 * first), each opening its page. No events (the page passes none, or none are left) leaves
 * "Coming up" out.
 */
export function searchSuggestionGroups(
  categories: readonly { label: string; category: EventCategory }[],
  /** The page's loaded events and the time they were loaded at (their date lines are relative to it). */
  loaded?: { events: readonly SheltuhEvent[]; now: Date },
): SearchSuggestionGroup[] {
  const groups: SearchSuggestionGroup[] = [
    {
      key: "categories",
      title: "Categories",
      options: categories.map(({ label, category }) => ({
        kind: "category",
        key: `category-${category}`,
        label,
        category,
        href: categoryHref(category),
      })),
    },
  ];
  const upcoming = loaded?.events.slice(0, SUGGESTED_EVENTS_MAX) ?? [];
  if (loaded && upcoming.length > 0) {
    const { now } = loaded;
    groups.push({
      key: "events",
      title: "Coming up",
      options: upcoming.map((event) => ({
        kind: "event",
        key: `event-${event.id}`,
        label: event.title,
        detail: cardMetaParts(event, now).join(" · "),
        href: `/events/${encodeURIComponent(event.slug)}`,
      })),
    });
  }
  return groups;
}

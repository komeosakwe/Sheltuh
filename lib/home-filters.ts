import { isOpenThisWeekend } from "./home-sections";
import { isTonight, matchesPricing } from "./scene-map-filters";
import type { EventCategory, SheltuhEvent } from "./types";

/**
 * The home's event filters (the proposal's All events row, redesign PR 3): Price, Category and
 * Date, the ones the loaded events can answer. Distance, Accessibility and Sort are deferred (no
 * data behind them). The category chips under the carousel set the same Category, and their
 * "Free" chip the same Price, so the two never disagree.
 */
export type HomeCategoryFilter = EventCategory | "all";
/** "under25": an all-inclusive ticket under A$25 (lib/scene-map-filters.ts matchesPricing, as Nearby's). */
export type HomePriceFilter = "all" | "free" | "under25";
/**
 * In each event's own zone: "tonight" is its calendar day (lib/scene-map-filters.ts isTonight);
 * "weekend" is the home's This weekend section's own rule (lib/home-sections.ts isOpenThisWeekend:
 * open between Friday 17:00 and Sunday night), so the filter and the section always agree.
 */
export type HomeDateFilter = "all" | "tonight" | "weekend";

export interface HomeFilters {
  category: HomeCategoryFilter;
  price: HomePriceFilter;
  date: HomeDateFilter;
}

export const NO_HOME_FILTERS: HomeFilters = { category: "all", price: "all", date: "all" };

export const HOME_PRICE_OPTIONS: { value: HomePriceFilter; label: string }[] = [
  { value: "all", label: "Any price" },
  { value: "free", label: "Free" },
  { value: "under25", label: "Under A$25" },
];

export const HOME_DATE_OPTIONS: { value: HomeDateFilter; label: string }[] = [
  { value: "all", label: "Any date" },
  { value: "tonight", label: "Tonight" },
  { value: "weekend", label: "This weekend" },
];

/** Whether any filter is set. */
export function hasHomeFilters(filters: HomeFilters): boolean {
  return filters.category !== "all" || filters.price !== "all" || filters.date !== "all";
}

/** Whether `event` passes every filter, at `now`. */
export function matchesHomeFilters(event: SheltuhEvent, filters: HomeFilters, now: Date): boolean {
  return (
    (filters.category === "all" || event.category === filters.category) &&
    matchesPricing(event, filters.price) &&
    (filters.date === "all" || (filters.date === "tonight" ? isTonight(event, now) : isOpenThisWeekend(event, now)))
  );
}

"use client";

import FilterChip from "@/components/ui/FilterChip";
import ScrollHint from "@/components/ui/ScrollHint";
import type { HomeFilters } from "@/lib/home-filters";
import type { EventCategory } from "@/lib/types";
import CategoryIcon, { type CategoryIconName } from "./CategoryIcon";

/** The proposal's chips between "All" and "Free": each category, in its own words (plural, as drawn). */
export const HOME_CATEGORIES: { label: string; category: EventCategory; icon: CategoryIconName }[] = [
  { label: "Live music", category: "live-music", icon: "music" },
  { label: "Art", category: "art", icon: "art" },
  { label: "Workshops", category: "workshop", icon: "workshop" },
  { label: "Pop-ups", category: "pop-up", icon: "pop-up" },
  { label: "Theatre", category: "theatre", icon: "theatre" },
];

/**
 * Browse by category (the proposal, redesign PR 3): a row of filter chips under the featured
 * carousel, "All" first and pressed by default, then each category and Free. They're the
 * quick way to set the home's own filters (the same Category and Price as All events' dropdowns,
 * so the two always agree), and they narrow every event listing below them: This weekend, From
 * organisers you follow and All events. Toggle buttons (`aria-pressed`, FilterChip), so the
 * choice is announced, not shown by colour alone. A category chip pressed again goes back to all
 * categories; "All" clears the category and Free. Below 1024px the row scrolls sideways inside
 * its own container (bleeding to the page's edges, so the page never does); from 1024px it wraps,
 * and from 1280px the seven chips are seven equal columns. A labelled group with no heading: the chips say what they are.
 */
export default function CategoryRow({
  filters,
  onChange,
  controls,
  className = "",
}: {
  filters: HomeFilters;
  onChange: (next: HomeFilters) => void;
  /** The id of what the chips filter (aria-controls). */
  controls?: string;
  className?: string;
}) {
  const free = filters.price === "free";
  const all = filters.category === "all" && !free;
  return (
    <div role="group" aria-label="Browse by category" className={className}>
      <ScrollHint className="-mx-4 md:-mx-8 lg:mx-0" fadeClassName="lg:hidden">
        <ul className="no-scrollbar flex gap-2 overflow-x-auto overscroll-x-contain px-4 py-1 md:gap-4 md:px-8 lg:flex-wrap lg:overflow-visible lg:px-0 xl:grid xl:grid-cols-7">
          <li className="flex shrink-0 xl:min-w-0">
            <FilterChip
              pressed={all}
              className="xl:w-full xl:justify-center"
              aria-controls={controls}
              onClick={() => onChange({ ...filters, category: "all", price: free ? "all" : filters.price })}
            >
              <CategoryIcon name="all" className="size-5" />
              All
            </FilterChip>
          </li>
          {HOME_CATEGORIES.map((item) => {
            const pressed = filters.category === item.category;
            return (
              <li key={item.category} className="flex shrink-0 xl:min-w-0">
                <FilterChip
                  pressed={pressed}
                  className="xl:w-full xl:justify-center"
                  aria-controls={controls}
                  onClick={() => onChange({ ...filters, category: pressed ? "all" : item.category })}
                >
                  <CategoryIcon name={item.icon} className="size-5" />
                  {item.label}
                </FilterChip>
              </li>
            );
          })}
          <li className="flex shrink-0 xl:min-w-0">
            <FilterChip
              pressed={free}
              className="xl:w-full xl:justify-center"
              aria-controls={controls}
              onClick={() => onChange({ ...filters, price: free ? "all" : "free" })}
            >
              <CategoryIcon name="free" className="size-5" />
              Free
            </FilterChip>
          </li>
        </ul>
      </ScrollHint>
    </div>
  );
}

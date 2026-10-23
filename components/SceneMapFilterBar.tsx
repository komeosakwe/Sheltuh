"use client";

import { fieldClass } from "@/components/ui/Field";
import FilterChip, { filterChipClass, SelectedDots } from "@/components/ui/FilterChip";
import type { ReactNode } from "react";
import type { EventCategory } from "@/lib/types";
import type { ScenePricingFilter, TimeFilter } from "@/lib/scene-map-filters";

interface Props {
  search: string;
  onSearchChange: (value: string) => void;
  categories: { value: EventCategory; label: string }[];
  category: EventCategory | "all";
  onCategoryChange: (value: EventCategory | "all") => void;
  time: TimeFilter;
  onTimeChange: (value: TimeFilter) => void;
  specificDate: string;
  onSpecificDateChange: (value: string) => void;
  suburbs: string[];
  suburb: string | "all";
  onSuburbChange: (value: string | "all") => void;
  pricing: ScenePricingFilter;
  onPricingChange: (value: ScenePricingFilter) => void;
}

/** Search + location, then time/category/price controls, for the Scene Map (fields §6.2, toggles §6.3). */
export default function SceneMapFilterBar({
  search,
  onSearchChange,
  categories,
  category,
  onCategoryChange,
  time,
  onTimeChange,
  specificDate,
  onSpecificDateChange,
  suburbs,
  suburb,
  onSuburbChange,
  pricing,
  onPricingChange,
}: Props) {
  return (
    <div className="flex flex-col gap-3 border-t border-foreground pt-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        {/* The label shows on phones, where the short placeholder alone would have to say it all. */}
        <div className="flex flex-1 flex-col gap-2">
          <label htmlFor="scene-search" className="eyebrow text-muted sm:sr-only">
            Search events, venues or suburbs
          </label>
          <div className="relative">
            <SearchIcon />
            <input
              id="scene-search"
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search events"
              className={`${fieldClass} pl-10`}
            />
          </div>
        </div>

        <label className="relative sm:w-60">
          <span className="sr-only">Location</span>
          <PinIcon />
          <select value={suburb} onChange={(event) => onSuburbChange(event.target.value)} className={`${fieldClass} pl-10`}>
            <option value="all">All of Melbourne</option>
            {suburbs.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Phones: one row that scrolls sideways (bleeding to the screen's edges), so the map starts
          near the top; it wraps from 640px. The vertical padding keeps focus rings inside the scroller. */}
      <form
        aria-label="Filter events"
        className="no-scrollbar -mx-5 flex flex-nowrap items-center gap-2 overflow-x-auto px-5 py-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:py-0"
        onSubmit={(event) => event.preventDefault()}
      >
        <FilterChip pressed={time === "tonight"} onClick={() => onTimeChange(time === "tonight" ? "all" : "tonight")}>
          Tonight
        </FilterChip>
        <FilterChip pressed={time === "weekend"} onClick={() => onTimeChange(time === "weekend" ? "all" : "weekend")}>
          This weekend
        </FilterChip>
        <ChipControl selected={time === "date"}>
          <label>
            <span className="sr-only">Choose a date</span>
            <input
              type="date"
              value={specificDate}
              onChange={(event) => {
                const value = event.target.value;
                onSpecificDateChange(value);
                onTimeChange(value ? "date" : "all");
              }}
              // Selected (black), the browser's own calendar icon and text go light too.
              className={filterChipClass(
                time === "date",
                `focus-visible:outline-offset-0 ${time === "date" ? "pl-8 scheme-dark" : ""}`,
              )}
            />
          </label>
        </ChipControl>

        <label className="sr-only" htmlFor="scene-category-filter">
          Category
        </label>
        <ChipControl selected={category !== "all"}>
        <select
          id="scene-category-filter"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as EventCategory | "all")}
          className={filterChipClass(category !== "all", `focus-visible:outline-offset-0 ${category !== "all" ? "pl-8" : ""}`)}
        >
          <option value="all">All scenes</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        </ChipControl>

        <label className="sr-only" htmlFor="scene-pricing-filter">
          Price
        </label>
        <ChipControl selected={pricing !== "all"}>
          <select
            id="scene-pricing-filter"
            value={pricing}
            onChange={(event) => onPricingChange(event.target.value as ScenePricingFilter)}
            className={filterChipClass(pricing !== "all", `focus-visible:outline-offset-0 ${pricing !== "all" ? "pl-8" : ""}`)}
          >
            <option value="all">Any price</option>
            <option value="free">Free</option>
            <option value="under25">Under $25</option>
          </select>
        </ChipControl>
      </form>
    </div>
  );
}

/**
 * A native control styled as a chip (a date field, a select): when it's set, it's black like a
 * pressed chip and carries the same two dots, drawn over its left padding (a field can't hold them).
 */
function ChipControl({ selected, children }: { selected: boolean; children: ReactNode }) {
  return (
    <span className="relative inline-flex shrink-0">
      {children}
      {selected && (
        <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2">
          <SelectedDots />
        </span>
      )}
    </span>
  );
}

const iconClass = "pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted";

function SearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" className={iconClass}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={iconClass}>
      <path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 12 3.5 6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.25" />
    </svg>
  );
}

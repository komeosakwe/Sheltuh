"use client";

import { fieldClass } from "@/components/ui/Field";
import FilterChip, { filterChipClass } from "@/components/ui/FilterChip";
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
        <label className="relative flex-1">
          <span className="sr-only">Search event names, venues or suburbs</span>
          <SearchIcon />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search events, venues or suburbs"
            className={`${fieldClass} pl-10`}
          />
        </label>

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

      <form
        aria-label="Filter events"
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => event.preventDefault()}
      >
        <FilterChip pressed={time === "tonight"} onClick={() => onTimeChange(time === "tonight" ? "all" : "tonight")}>
          Tonight
        </FilterChip>
        <FilterChip pressed={time === "weekend"} onClick={() => onTimeChange(time === "weekend" ? "all" : "weekend")}>
          This weekend
        </FilterChip>
        <label className="relative">
          <span className="sr-only">Choose a date</span>
          <input
            type="date"
            value={specificDate}
            onChange={(event) => {
              const value = event.target.value;
              onSpecificDateChange(value);
              onTimeChange(value ? "date" : "all");
            }}
            className={filterChipClass(time === "date", "focus-visible:outline-offset-0")}
          />
        </label>

        <label className="sr-only" htmlFor="scene-category-filter">
          Category
        </label>
        <select
          id="scene-category-filter"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as EventCategory | "all")}
          className={filterChipClass(false, "focus-visible:outline-offset-0")}
        >
          <option value="all">All scenes</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor="scene-pricing-filter">
          Price
        </label>
        <select
          id="scene-pricing-filter"
          value={pricing}
          onChange={(event) => onPricingChange(event.target.value as ScenePricingFilter)}
          className={filterChipClass(false, "focus-visible:outline-offset-0")}
        >
          <option value="all">Any price</option>
          <option value="free">Free</option>
          <option value="under25">Under $25</option>
        </select>
      </form>
    </div>
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

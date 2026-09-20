"use client";

import type { CSSProperties } from "react";
import type { EventCategory } from "@/lib/types";
import type { ScenePricingFilter, TimeFilter } from "@/lib/scene-map-filters";

const ORANGE = "#e15b27";
const FIELD_STYLE = { background: "#0e0d0c", borderColor: "#484039", color: "#d5cec3" };

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

function pillStyle(active: boolean): CSSProperties {
  // White text on this orange is only ~3.7:1 — short of WCAG's 4.5:1 for
  // normal-size text — so active pills use dark text instead.
  return active ? { background: ORANGE, borderColor: ORANGE, color: "#17140f", fontWeight: 600 } : FIELD_STYLE;
}

/** Search + location, then time/category/price controls, for the Scene Map. */
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
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search event names, venues or suburbs</span>
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            &#128269;
          </span>
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search events, venues or suburbs"
            className="h-11 w-full rounded-lg border pl-9 pr-3 font-sans text-sm"
            style={FIELD_STYLE}
          />
        </label>

        <label className="relative">
          <span className="sr-only">Location</span>
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            &#8982;
          </span>
          <select
            value={suburb}
            onChange={(event) => onSuburbChange(event.target.value)}
            className="h-11 w-full rounded-lg border py-2 pl-9 pr-3 font-sans text-sm sm:w-60"
            style={FIELD_STYLE}
          >
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
        <button
          type="button"
          aria-pressed={time === "tonight"}
          onClick={() => onTimeChange(time === "tonight" ? "all" : "tonight")}
          className="h-9 rounded-full border px-3.5 font-sans text-sm font-medium"
          style={pillStyle(time === "tonight")}
        >
          Tonight
        </button>
        <button
          type="button"
          aria-pressed={time === "weekend"}
          onClick={() => onTimeChange(time === "weekend" ? "all" : "weekend")}
          className="h-9 rounded-full border px-3.5 font-sans text-sm font-medium"
          style={pillStyle(time === "weekend")}
        >
          This weekend
        </button>
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
            className="h-9 rounded-full border px-3.5 font-sans text-sm font-medium"
            style={pillStyle(time === "date")}
          />
        </label>

        <label className="sr-only" htmlFor="scene-category-filter">
          Category
        </label>
        <select
          id="scene-category-filter"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as EventCategory | "all")}
          className="h-9 rounded-full border px-3.5 font-sans text-sm"
          style={FIELD_STYLE}
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
          className="h-9 rounded-full border px-3.5 font-sans text-sm"
          style={FIELD_STYLE}
        >
          <option value="all">Any price</option>
          <option value="free">Free</option>
          <option value="under25">Under $25</option>
        </select>
      </form>
    </div>
  );
}

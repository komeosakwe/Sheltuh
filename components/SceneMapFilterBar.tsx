"use client";

import type { EventCategory } from "@/lib/types";
import type { TimeFilter } from "@/lib/scene-map-filters";

export type ScenePricingFilter = "all" | "free" | "paid";

interface Props {
  categories: { value: EventCategory; label: string }[];
  category: EventCategory | "all";
  onCategoryChange: (value: EventCategory | "all") => void;
  time: TimeFilter;
  onTimeChange: (value: TimeFilter) => void;
  suburbs: string[];
  suburb: string | "all";
  onSuburbChange: (value: string | "all") => void;
  pricing: ScenePricingFilter;
  onPricingChange: (value: ScenePricingFilter) => void;
  hasActiveFilters: boolean;
  onReset: () => void;
}

const FIELD_STYLE = {
  background: "#0e0d0c",
  borderColor: "#484039",
  color: "#d5cec3",
};

/** Filter bar for the Scene Map: time, neighbourhood, category and price — all wired to real event data. */
export default function SceneMapFilterBar({
  categories,
  category,
  onCategoryChange,
  time,
  onTimeChange,
  suburbs,
  suburb,
  onSuburbChange,
  pricing,
  onPricingChange,
  hasActiveFilters,
  onReset,
}: Props) {
  return (
    <form
      aria-label="Filter events"
      className="flex flex-wrap items-center gap-2"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="sr-only" htmlFor="scene-time-filter">
        Time
      </label>
      <select
        id="scene-time-filter"
        value={time}
        onChange={(event) => onTimeChange(event.target.value as TimeFilter)}
        className="rounded border px-3 py-2 text-sm"
        style={FIELD_STYLE}
      >
        <option value="all">Any time</option>
        <option value="tonight">Tonight</option>
        <option value="week">This week</option>
      </select>

      <label className="sr-only" htmlFor="scene-suburb-filter">
        Neighbourhood
      </label>
      <select
        id="scene-suburb-filter"
        value={suburb}
        onChange={(event) => onSuburbChange(event.target.value)}
        className="rounded border px-3 py-2 text-sm"
        style={FIELD_STYLE}
      >
        <option value="all">Near Melbourne</option>
        {suburbs.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <label className="sr-only" htmlFor="scene-category-filter">
        Category
      </label>
      <select
        id="scene-category-filter"
        value={category}
        onChange={(event) => onCategoryChange(event.target.value as EventCategory | "all")}
        className="rounded border px-3 py-2 text-sm"
        style={FIELD_STYLE}
      >
        <option value="all">Any scene</option>
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
        className="rounded border px-3 py-2 text-sm"
        style={FIELD_STYLE}
      >
        <option value="all">Free or paid</option>
        <option value="free">Free</option>
        <option value="paid">Paid</option>
      </select>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onReset}
          className="rounded border px-3 py-2 text-sm font-medium transition-colors"
          style={{ borderColor: "#484039", color: "#d5cec3" }}
        >
          Reset filters
        </button>
      )}
    </form>
  );
}

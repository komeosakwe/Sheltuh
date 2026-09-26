"use client";

import type { EventCategory } from "@/lib/types";

export type PricingFilter = "all" | "free" | "paid";

interface Props {
  categories: { value: EventCategory; label: string }[];
  category: EventCategory | "all";
  onCategoryChange: (value: EventCategory | "all") => void;
  pricing: PricingFilter;
  onPricingChange: (value: PricingFilter) => void;
  onOrAfter: string;
  onOnOrAfterChange: (value: string) => void;
  hasActiveFilters: boolean;
  onReset: () => void;
}

/** Controlled filter form shared by the demo (client-filtered) and live (server-filtered) feeds. */
export default function EventFilterBar({
  categories,
  category,
  onCategoryChange,
  pricing,
  onPricingChange,
  onOrAfter,
  onOnOrAfterChange,
  hasActiveFilters,
  onReset,
}: Props) {
  return (
    <form
      aria-label="Filter events"
      className="grid grid-cols-1 gap-4 rounded-lg border border-surface-border bg-surface p-4 sm:grid-cols-3 sm:items-end"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="category-filter" className="text-sm font-medium text-muted">
          Category
        </label>
        <select
          id="category-filter"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as EventCategory | "all")}
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="date-filter" className="text-sm font-medium text-muted">
          On or after
        </label>
        <input
          id="date-filter"
          type="date"
          value={onOrAfter}
          onChange={(event) => onOnOrAfterChange(event.target.value)}
          className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
        />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium text-muted">Price</legend>
        <div className="flex gap-3 pt-1">
          {(["all", "free", "paid"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="radio"
                name="pricing"
                value={value}
                checked={pricing === value}
                onChange={() => onPricingChange(value)}
                className="accent-accent"
              />
              {value === "all" ? "All" : value === "free" ? "Free" : "Paid"}
            </label>
          ))}
        </div>
      </fieldset>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onReset}
          className="rounded border border-surface-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent sm:col-span-3 sm:w-fit"
        >
          Reset filters
        </button>
      )}
    </form>
  );
}

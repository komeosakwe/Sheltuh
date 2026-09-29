"use client";

import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
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
      className="grid grid-cols-1 gap-5 border-t border-foreground pt-5 sm:grid-cols-3 sm:items-end"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor="category-filter" className="eyebrow text-muted">
          Category
        </label>
        <select
          id="category-filter"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value as EventCategory | "all")}
          className={fieldClass}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="date-filter" className="eyebrow text-muted">
          On or after
        </label>
        <input
          id="date-filter"
          type="date"
          value={onOrAfter}
          onChange={(event) => onOnOrAfterChange(event.target.value)}
          className={fieldClass}
        />
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="eyebrow text-muted">Price</legend>
        <div className="flex gap-3 pt-1">
          {(["all", "free", "paid"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1.5 text-sm text-foreground">
              <input
                type="radio"
                name="pricing"
                value={value}
                checked={pricing === value}
                onChange={() => onPricingChange(value)}
              />
              {value === "all" ? "All" : value === "free" ? "Free" : "Paid"}
            </label>
          ))}
        </div>
      </fieldset>

      {hasActiveFilters && (
        <Button variant="outline" size="sm" onClick={onReset} className="sm:col-span-3 sm:w-fit">
          Reset filters
        </Button>
      )}
    </form>
  );
}

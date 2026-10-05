"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/Field";
import type { PricingFilter } from "@/lib/event-filter-params";
import type { EventCategory } from "@/lib/types";

export type { PricingFilter };

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

const PANEL_ID = "event-filters";

/**
 * Controlled filter form shared by the demo (client-filtered) and live (server-filtered) feeds.
 * On phones the controls sit behind a "Filters" disclosure (closed by default); from `sm` up
 * they are always shown and the toggle is hidden.
 */
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
  const [open, setOpen] = useState(false);
  const activeCount = [category !== "all", pricing !== "all", onOrAfter !== ""].filter(Boolean).length;

  return (
    <form
      aria-label="Filter events"
      className="flex flex-col gap-4 border-t border-foreground pt-5 sm:block"
      onSubmit={(event) => event.preventDefault()}
    >
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls={PANEL_ID}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        className="h-11 self-start sm:hidden"
      >
        <span>
          Filters
          {activeCount > 0 && (
            <>
              <span aria-hidden="true"> · {activeCount}</span>
              <span className="sr-only">, {activeCount} active</span>
            </>
          )}
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-3 w-3 motion-safe:transition-transform motion-safe:duration-150 ${open ? "rotate-180" : ""}`}
        >
          <path d="m2.5 4.5 3.5 3.5 3.5-3.5" />
        </svg>
      </Button>

      <div
        id={PANEL_ID}
        className={`${open ? "grid" : "hidden"} grid-cols-1 gap-4 sm:grid sm:grid-cols-3 sm:items-end sm:gap-5`}
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
          <div className="flex gap-4 pt-1 sm:gap-3">
            {(["all", "free", "paid"] as const).map((value) => (
              <label key={value} className="flex min-h-11 items-center gap-1.5 text-sm text-foreground sm:min-h-0">
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
      </div>
    </form>
  );
}

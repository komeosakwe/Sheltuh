"use client";

import { useMemo, useState } from "react";
import EventCard from "@/components/EventCard";
import { isFreeEvent } from "@/lib/data";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

type PricingFilter = "all" | "free" | "paid";

interface EventBrowserProps {
  events: SheltuhEvent[];
  categories: { value: EventCategory; label: string }[];
}

export default function EventBrowser({ events, categories }: EventBrowserProps) {
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [pricing, setPricing] = useState<PricingFilter>("all");
  const [onOrAfter, setOnOrAfter] = useState("");

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => category === "all" || event.category === category)
      .filter((event) => {
        if (pricing === "all") return true;
        const free = isFreeEvent(event);
        return pricing === "free" ? free : !free;
      })
      .filter((event) => onOrAfter === "" || event.startsAt.slice(0, 10) >= onOrAfter)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, category, pricing, onOrAfter]);

  const hasActiveFilters = category !== "all" || pricing !== "all" || onOrAfter !== "";

  function resetFilters() {
    setCategory("all");
    setPricing("all");
    setOnOrAfter("");
  }

  return (
    <div className="flex flex-col gap-6">
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
            onChange={(event) => setCategory(event.target.value as EventCategory | "all")}
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
            onChange={(event) => setOnOrAfter(event.target.value)}
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
                  onChange={() => setPricing(value)}
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
            onClick={resetFilters}
            className="rounded border border-surface-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:border-accent hover:text-accent sm:col-span-3 sm:w-fit"
          >
            Reset filters
          </button>
        )}
      </form>

      {filteredEvents.length === 0 ? (
        <div className="rounded-lg border border-dashed border-surface-border p-10 text-center">
          <p className="font-heading text-2xl text-foreground">No events match your filters</p>
          <p className="mt-2 text-sm text-muted">
            Try a different category, an earlier date, or clearing the price filter.
          </p>
          <button
            type="button"
            onClick={resetFilters}
            className="mt-4 rounded bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-strong"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

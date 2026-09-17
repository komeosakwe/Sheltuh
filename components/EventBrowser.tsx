"use client";

import { useMemo, useState } from "react";
import EventCard from "@/components/EventCard";
import EventFilterBar, { type PricingFilter } from "@/components/EventFilterBar";
import { isFreeEvent } from "@/lib/data";
import { formatEventDateKey } from "@/lib/format";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

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
      .filter((event) => onOrAfter === "" || formatEventDateKey(event.startsAt) >= onOrAfter)
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
      <EventFilterBar
        categories={categories}
        category={category}
        onCategoryChange={setCategory}
        pricing={pricing}
        onPricingChange={setPricing}
        onOrAfter={onOrAfter}
        onOnOrAfterChange={setOnOrAfter}
        hasActiveFilters={hasActiveFilters}
        onReset={resetFilters}
      />

      <p aria-live="polite" className="text-sm text-muted">
        Showing {filteredEvents.length} of {events.length} events
      </p>

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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {filteredEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

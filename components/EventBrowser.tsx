"use client";

import { useMemo, useState } from "react";
import EventResults from "@/components/EventResults";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
import EventFilterBar, { type PricingFilter } from "@/components/EventFilterBar";
import { isFreeEvent } from "@/lib/data";
import { formatEventDateKey } from "@/lib/format";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

interface EventBrowserProps {
  events: SheltuhEvent[];
  categories: { value: EventCategory; label: string }[];
  /** Free-text search (from /search), matched the same way the live API does. */
  query?: string;
}

function matchesQuery(event: SheltuhEvent, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [event.title, event.venueName, event.suburb, event.organiserName, event.description].some((field) =>
    field?.toLowerCase().includes(needle),
  );
}

export default function EventBrowser({ events, categories, query = "" }: EventBrowserProps) {
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [pricing, setPricing] = useState<PricingFilter>("all");
  const [onOrAfter, setOnOrAfter] = useState("");

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => matchesQuery(event, query))
      .filter((event) => category === "all" || event.category === category)
      .filter((event) => {
        if (pricing === "all") return true;
        const free = isFreeEvent(event);
        return pricing === "free" ? free : !free;
      })
      .filter((event) => onOrAfter === "" || formatEventDateKey(event.startsAt) >= onOrAfter)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }, [events, query, category, pricing, onOrAfter]);

  const hasActiveFilters = category !== "all" || pricing !== "all" || onOrAfter !== "";

  function resetFilters() {
    setCategory("all");
    setPricing("all");
    setOnOrAfter("");
  }

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
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
        <EmptyState
          title="No events match your filters"
          action={<Button onClick={resetFilters}>Reset filters</Button>}
        >
          Try a different category, an earlier date, or clearing the price filter.
        </EmptyState>
      ) : (
        <EventResults events={filteredEvents} />
      )}
    </div>
  );
}

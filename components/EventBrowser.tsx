"use client";

import { useEffect, useMemo, useState } from "react";
import EventResults from "@/components/EventResults";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/Section";
import EventFilterBar, { type PricingFilter } from "@/components/EventFilterBar";
import NearbyResults from "@/components/search/NearbyResults";
import { isFreeEvent, isPaidEvent } from "@/lib/data";
import { eventZone, formatEventDateKey } from "@/lib/format";
import type { Locality } from "@/lib/location";
import type { EventCategory, SheltuhEvent } from "@/lib/types";

interface EventBrowserProps {
  events: SheltuhEvent[];
  categories: { value: EventCategory; label: string }[];
  /** Free-text search (from /search), matched the same way the live API does. */
  query?: string;
  /**
   * The suburb from /search?near=, already found in the suburb table (by the
   * page, on the server): results in bands by distance from it (lib/location.ts).
   */
  near?: Locality;
  /** Starting filters (from /events?category=&pricing=); "Reset filters" still clears to all. */
  initialCategory?: EventCategory | "all";
  initialPricing?: PricingFilter;
  /**
   * Receives the results sentence ("Showing 5 of 8 events") whenever it
   * changes, for the host's persistent status region to announce. The visible
   * count here isn't a live region: it's mounted with its text already in it.
   */
  onSummaryChange?: (summary: string) => void;
}

function matchesQuery(event: SheltuhEvent, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [event.title, event.venueName, event.suburb, event.organiserName, event.description].some((field) =>
    field?.toLowerCase().includes(needle),
  );
}

export default function EventBrowser({
  events,
  categories,
  query = "",
  near,
  initialCategory = "all",
  initialPricing = "all",
  onSummaryChange,
}: EventBrowserProps) {
  const [category, setCategory] = useState<EventCategory | "all">(initialCategory);
  const [pricing, setPricing] = useState<PricingFilter>(initialPricing);
  const [onOrAfter, setOnOrAfter] = useState("");
  // When the page opened: events that had ended by then are the feed's "recently ended" tail.
  const [nowMs] = useState(() => Date.now());

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => matchesQuery(event, query))
      .filter((event) => category === "all" || event.category === category)
      .filter((event) => {
        if (pricing === "all") return true;
        // An event with no ticket types yet is neither free nor paid.
        return pricing === "free" ? isFreeEvent(event) : isPaidEvent(event);
      })
      // Each event's own local date, as the live feed's onOrAfter reads it.
      .filter((event) => onOrAfter === "" || formatEventDateKey(event.startsAt, eventZone(event.timeZone)) >= onOrAfter)
      // Soonest first; ended events (the feed's last 2 weeks) keep the order they came in, after the rest.
      .sort((a, b) => {
        const aEnded = Date.parse(a.endsAt ?? a.startsAt) <= nowMs;
        const bEnded = Date.parse(b.endsAt ?? b.startsAt) <= nowMs;
        return Number(aEnded) - Number(bEnded) || (aEnded ? 0 : a.startsAt.localeCompare(b.startsAt));
      });
  }, [nowMs, events, query, category, pricing, onOrAfter]);

  const hasActiveFilters = category !== "all" || pricing !== "all" || onOrAfter !== "";
  const summary = `Showing ${filteredEvents.length} of ${events.length} events`;

  useEffect(() => {
    onSummaryChange?.(summary);
  }, [summary, onSummaryChange]);

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

      <p className="meta text-muted">{summary}</p>

      {filteredEvents.length === 0 ? (
        <EmptyState
          title="No events match your filters"
          action={<Button onClick={resetFilters}>Reset filters</Button>}
        />
      ) : near ? (
        <NearbyResults events={filteredEvents} origin={near} />
      ) : (
        <EventResults events={filteredEvents} heading="Events" />
      )}
    </div>
  );
}

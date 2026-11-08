"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";
import type { TicketingMode } from "@/lib/ticketing";
import type { EventCategory } from "@/lib/types";

/**
 * One `event_viewed` for an event page opened (the funnel's second step), with
 * the event's public slug, category and where its tickets are sold. Renders
 * nothing and does nothing while analytics is off.
 */
export default function EventViewedTracker({
  slug,
  category,
  ticketingMode,
}: {
  slug: string;
  category: EventCategory;
  ticketingMode: TicketingMode;
}) {
  useEffect(() => {
    track("event_viewed", { event_slug: slug, category, ticketing_mode: ticketingMode });
  }, [slug, category, ticketingMode]);
  return null;
}

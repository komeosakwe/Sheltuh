"use client";

import { useEffect } from "react";

/**
 * Arriving at an event page's `#tickets` (a card's "Get tickets" link, or
 * the buy bar) moves keyboard and screen-reader focus to the ticket section,
 * not just the scroll position (docs/design/brand-direction-one.md §6.6).
 * Mounted with the event's view, so in live mode it runs once the event has
 * loaded and the section exists. Renders nothing.
 */
export default function TicketsHashFocus() {
  useEffect(() => {
    const focusTickets = () => {
      if (window.location.hash !== "#tickets") return;
      document.getElementById("tickets")?.focus({ preventScroll: false });
    };
    focusTickets();
    window.addEventListener("hashchange", focusTickets);
    return () => window.removeEventListener("hashchange", focusTickets);
  }, []);
  return null;
}

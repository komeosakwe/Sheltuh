"use client";

import { useMemo } from "react";
import SearchBar from "@/components/SearchBar";
import { useOptionalHomeEvents } from "./HomeEventsProvider";

/**
 * The home hero's search bar: the site's SearchBar, suggesting a few of the events the home has
 * already loaded (upcoming, soonest first, the saved suburb's state first) under its empty field,
 * so nothing more is fetched. Until they've loaded, or if they fail, it suggests the categories
 * only.
 */
export default function HomeSearchBar() {
  const home = useOptionalHomeEvents();
  const state = home?.state;
  const suggestedEvents = useMemo(
    () => (state?.status === "ready" ? { events: state.events, now: state.now } : undefined),
    [state],
  );
  return <SearchBar suggestedEvents={suggestedEvents} />;
}

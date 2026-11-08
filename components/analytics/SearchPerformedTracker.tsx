"use client";

import { useEffect } from "react";
import { track } from "@/lib/analytics";

/**
 * One `search_performed` for a search results page opened: only whether there
 * were words and a place, never what they were. Render it with a `key` that
 * changes with the search, so each search counts. Renders nothing and does
 * nothing while analytics is off.
 */
export default function SearchPerformedTracker({ hasQuery, hasLocation }: { hasQuery: boolean; hasLocation: boolean }) {
  useEffect(() => {
    track("search_performed", { has_query: hasQuery, has_location: hasLocation });
  }, [hasQuery, hasLocation]);
  return null;
}

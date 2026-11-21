"use client";

import { useEffect, useState } from "react";
import { isApiConfigured } from "@/lib/api/client";
import { getPublicEventBySlug } from "@/lib/api/public-events";
import { adaptPublicEvent } from "@/lib/live/adapt";
import type { SheltuhEvent } from "@/lib/types";

/**
 * The public event behind a ticket, by its slug: what its own page shows
 * (image, street address, map pin), for the My ticket page to add to what
 * the order already says. Null until it's loaded, when there's no slug, and
 * when it can't be loaded: the ticket page is complete without it (the order
 * carries the event's name, date, venue and suburb), so a failure here isn't
 * an error to show, only less decoration.
 */
export function useTicketEvent(slug: string | null | undefined): SheltuhEvent | null {
  const [loaded, setLoaded] = useState<{ slug: string; event: SheltuhEvent } | null>(null);
  useEffect(() => {
    if (!slug || !isApiConfigured) return;
    let cancelled = false;
    getPublicEventBySlug(slug)
      .then((event) => {
        if (!cancelled) setLoaded({ slug, event: adaptPublicEvent(event) });
      })
      .catch(() => {
        // See above: the page shows the order's own details.
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);
  return loaded && loaded.slug === slug ? loaded.event : null;
}

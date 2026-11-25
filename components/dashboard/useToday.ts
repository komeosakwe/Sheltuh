"use client";

import { useEffect, useState } from "react";
import { formatEventDateKey } from "@/lib/format";

/**
 * Now, for a dashboard page's dates ("Tuesday, 17 November", "before Saturday"): taken when the page
 * opens and taken again once Melbourne's date has moved on (checked each minute), so a page left open
 * overnight doesn't keep yesterday's. The same Date between checks, so nothing re-renders for it.
 */
export function useToday(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => {
      const next = new Date();
      setNow((current) => (formatEventDateKey(current.toISOString()) === formatEventDateKey(next.toISOString()) ? current : next));
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

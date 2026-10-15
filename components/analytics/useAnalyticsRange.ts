"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { melbourneToday } from "@/lib/analytics-format";
import { parseRange, rangeSearch, type RangeOptions, type RangeState } from "@/lib/analytics-range";

/**
 * The page's range, read from and written to the URL (`router.replace`, no
 * scroll), so a report can be bookmarked or shared and Back works. Needs a
 * <Suspense> boundary above it (it reads search params).
 */
export function useAnalyticsRange(options: RangeOptions) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  // Fixed for the life of the page, so "today" can't shift mid-session and refetch.
  const [today] = useState(() => melbourneToday());
  const { allowAllTime, defaultPreset } = options;

  const search = searchParams.toString();
  const fromUrl = useMemo(
    () => parseRange(new URLSearchParams(search), { allowAllTime, defaultPreset }, today),
    [search, allowAllTime, defaultPreset, today],
  );
  // The URL updates in a transition; until it does, show the choice just made
  // (a controlled checkbox or select would otherwise snap back for a moment).
  const [pending, setPending] = useState<{ whileSearch: string; range: RangeState } | null>(null);
  const range = pending && pending.whileSearch === search ? pending.range : fromUrl;

  const setRange = useCallback(
    (next: RangeState) => {
      setPending({ whileSearch: search, range: next });
      router.replace(`${pathname}?${rangeSearch(next)}`, { scroll: false });
    },
    [router, pathname, search],
  );

  return { range, setRange, today };
}

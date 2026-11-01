"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import DemoBanner from "@/components/DemoBanner";
import { isApiConfigured } from "@/lib/api/client";

/** The full-screen swipe feed (app/swipe): it brings its own `<main>`, and no header or footer. */
export function isSwipePath(pathname: string | null): boolean {
  return pathname === "/swipe";
}

/** The site's header or footer: everywhere but the swipe feed, which is the whole screen. */
export function HideOnSwipe({ children }: { children: ReactNode }) {
  return isSwipePath(usePathname()) ? null : children;
}

/**
 * The page's `<main id="main">` with the demo's sample-data strip, around every
 * page but the swipe feed, which is its own `<main>` (a page has one) and shows
 * the demo note in its own corner.
 */
export function SiteMain({ children }: { children: ReactNode }) {
  if (isSwipePath(usePathname())) return children;
  return (
    <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
      {/* The demo's one sample-data disclosure, at the top of every page. */}
      {!isApiConfigured && <DemoBanner />}
      {children}
    </main>
  );
}

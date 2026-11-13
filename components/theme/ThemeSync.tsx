"use client";

import { useEffect, useLayoutEffect } from "react";
import { applyTheme, getTheme, readStoredTheme, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Keeps the page's theme in step after the no-flash script (lib/theme.ts,
 * docs/design/theme-white-dark.md §5.5). Renders nothing; mounted once in
 * the root layout. (The theme-color is black in both themes, after the black
 * header, so there's nothing to re-sync on a theme change.)
 * - Another tab's choice applies here too (without being written back),
 *   including on a page restored from the back/forward cache.
 * - In development React's Strict Mode remount resets <html>'s attributes,
 *   dropping the script's data-theme: it's re-applied from storage before
 *   paint (a no-op in production).
 */
export default function ThemeSync() {
  useLayoutEffect(() => {
    const stored = readStoredTheme();
    if (stored !== getTheme()) applyTheme(stored);
  }, []);

  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
      applyTheme(readStoredTheme());
    }
    // A page restored from the back/forward cache missed any storage events while it was away.
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) applyTheme(readStoredTheme());
    }
    window.addEventListener("storage", handleStorage);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return null;
}

"use client";

import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect } from "react";
import { applyTheme, getTheme, readStoredTheme, subscribeTheme, syncThemeColor, THEME_STORAGE_KEY } from "@/lib/theme";

/**
 * Keeps the page's theme in step after the no-flash script (lib/theme.ts,
 * docs/design/theme-white-dark.md §5.5). Renders nothing; mounted once in
 * the root layout.
 * - theme-color: Next rewrites the viewport metadata on navigation, so the
 *   meta is re-synced on mount, on every route change, whenever the head's
 *   theme-color changes and on every theme change (white <-> black only; the
 *   door's colour is left alone).
 * - Another tab's choice applies here too (without being written back),
 *   including on a page restored from the back/forward cache.
 * - In development React's Strict Mode remount resets <html>'s attributes,
 *   dropping the script's data-theme: it's re-applied from storage before
 *   paint (a no-op in production).
 */
export default function ThemeSync() {
  const pathname = usePathname();

  useLayoutEffect(() => {
    const stored = readStoredTheme();
    if (stored !== getTheme()) applyTheme(stored);
  }, []);

  useEffect(() => {
    syncThemeColor();
  }, [pathname]);

  useEffect(() => {
    const unsubscribe = subscribeTheme(() => syncThemeColor());
    // The viewport metadata can land after the route change commits (it streams): catch it whenever
    // the head's theme-color is added or rewritten. Re-syncing is idempotent, so its own edit settles.
    const observer = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(() => syncThemeColor());
    observer?.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ["content"] });
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
      unsubscribe();
      observer?.disconnect();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return null;
}

"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProgressLoader, useLoadingProgress } from "@/components/ui/ProgressLoader";

/** Only a navigation slower than this shows the indicator: no flash on quick ones. */
const SHOW_AFTER_MS = 150;
/** Give up on a navigation that never lands (an error, a cancelled load). */
const GIVE_UP_MS = 15_000;

/** The same-site page a click on this anchor would open, or null (new tab, download, same page, another site, API). */
export function navigationTarget(anchor: HTMLAnchorElement, current: Location): string | null {
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;
  let next: URL;
  try {
    next = new URL(anchor.href, current.href);
  } catch {
    return null;
  }
  if (next.origin !== current.origin) return null;
  if (next.pathname.startsWith("/api/")) return null;
  // A fragment on this page (or this very page) isn't a route change.
  if (next.pathname === current.pathname && next.search === current.search) return null;
  return next.pathname + next.search;
}

/**
 * The route-transition indicator (owner request, 21 Oct 2026): when a link
 * to another page takes more than a moment to load, the branded loader with
 * an estimated percentage appears just under the header, and completes to
 * 100% when the new page is in. Next.js announces the new page itself, so
 * this adds no announcements of its own.
 */
export default function RouteProgress() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const url = search ? `${pathname}?${search}` : pathname;
  const [landedUrl, setLandedUrl] = useState(url);
  const [pending, setPending] = useState(false);
  const [delayed, setDelayed] = useState(false);

  // The URL changed: the navigation has landed.
  if (landedUrl !== url) {
    setLandedUrl(url);
    setPending(false);
  }

  useEffect(() => {
    function onClick(event: MouseEvent) {
      // Next's <Link> prevents the default itself to navigate client-side, so that's no signal here.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (!navigationTarget(anchor, window.location)) return;
      setDelayed(false);
      setPending(true);
    }
    const onPopState = () => setPending(false);
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPopState);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPopState);
    };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const show = setTimeout(() => setDelayed(true), SHOW_AFTER_MS);
    const giveUp = setTimeout(() => setPending(false), GIVE_UP_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [pending]);

  const progress = useLoadingProgress(pending);
  if (!progress.visible || !delayed) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(var(--header-h)+env(safe-area-inset-top)+0.5rem)] z-[1300] flex justify-center px-5">
      <ProgressLoader
        percent={progress.percent}
        done={progress.done}
        label="Loading page"
        className="rounded-control border border-foreground bg-card px-3 py-2"
      />
    </div>
  );
}

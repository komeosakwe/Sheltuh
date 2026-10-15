"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { safeNextPath } from "@/lib/safe-next-path";
import type { SaveTarget } from "./favourites-store";
import { useFavourites } from "./FavouritesProvider";

/** The URL without `save`, as a same-site path (or null if it somehow isn't one). */
export function pathWithoutSave(pathname: string, search: URLSearchParams): string | null {
  const rest = new URLSearchParams(search);
  rest.delete("save");
  const qs = rest.toString();
  return safeNextPath(qs ? `${pathname}?${qs}` : pathname);
}

/**
 * Finishes a save started while signed out (§5.3): the heart's sign-in link
 * returns to `/events/{slug}?save=1`. Once the viewer is signed in and their
 * ids are loaded, this saves **this page's own event** (idempotent), shows
 * "Saved {title}." with Undo, and drops `save` from the URL. It never reads
 * an event id from the URL, so a crafted link can only add the event whose
 * page it opens, to the signed-in person's own list. Does nothing while
 * signed out, and nothing in demo mode (hearts there never go to sign in).
 * Mount it inside <Suspense> (it reads search params).
 */
export default function SaveOnReturn({ event }: { event: SaveTarget }) {
  const favourites = useFavourites();
  // Demo hearts never go to sign in, and without a provider there's nothing to save to.
  if (!favourites || favourites.mode !== "live") return null;
  return <SaveOnReturnLive event={event} />;
}

function SaveOnReturnLive({ event }: { event: SaveTarget }) {
  const favourites = useFavourites();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const done = useRef<string | null>(null);

  const wantsSave = searchParams.get("save") === "1";
  const ready = favourites?.mode === "live" && !favourites.signedOut && favourites.status === "ready";
  const saveFromReturn = favourites?.saveFromReturn;

  useEffect(() => {
    if (!wantsSave || !ready || !saveFromReturn || done.current === event.id) return;
    // Only on the event's own page.
    if (pathname !== `/events/${event.slug}`) return;
    done.current = event.id;
    saveFromReturn(event);
    const clean = pathWithoutSave(pathname, new URLSearchParams(searchParams.toString()));
    if (clean) router.replace(clean, { scroll: false });
  }, [wantsSave, ready, saveFromReturn, event, pathname, searchParams, router]);

  return null;
}

"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { actionRowClass, actionRowLabelClass } from "@/components/ui/Button";
import { withNext } from "@/lib/safe-next-path";
import type { SaveTarget } from "./favourites-store";
import { useFavourites } from "./FavouritesProvider";
import HeartIcon from "./HeartIcon";

export type SaveButtonVariant = "overlay" | "glass" | "plain" | "action";

/**
 * The 44px+ hit area and the visible mark, per variant and state. Saved, the heart fills Signal
 * Orange (the rules' card anatomy: "outline → filled orange"; a non-text mark, 3.4:1 on white).
 */
function classes(variant: SaveButtonVariant, saved: boolean) {
  const heart = saved ? "text-signal" : "";
  switch (variant) {
    // The event page's action row, beside Share and Calendar: the page's one Save.
    case "action":
      return {
        target: `group/save ${actionRowClass}`,
        mark: null,
        icon: `size-4 shrink-0 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-active/save:scale-90 ${heart}`.trim(),
      };
    case "plain":
      return {
        target: "group/save flex size-11 items-center justify-center text-foreground",
        mark: null,
        icon: `size-5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-active/save:scale-90 ${heart}`.trim(),
      };
    // An event card's photo corner (the rules' card anatomy and icon button): a 32px white
    // rounded square with a black heart, in a 48px target on phones and a 40px one from 768px.
    // White and black in both themes (it sits on a photo, which can be dark or light). Keyboard
    // focus rings the mark, black on a white gap that shows on any photo (never orange).
    case "overlay":
      return {
        target: "group/save flex size-12 items-center justify-center rounded-control focus-visible:outline-none! md:size-10",
        mark: "flex size-8 items-center justify-center rounded-control bg-paper text-ink motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-active/save:scale-90 group-hover/save:bg-hover group-focus-visible/save:ring-2 group-focus-visible/save:ring-ink group-focus-visible/save:ring-offset-2 group-focus-visible/save:ring-offset-paper",
        icon: `size-5 ${heart}`.trim(),
      };
    // The This weekend card's photo corner (owner's mockup, 8 Nov 2026): a 32px rounded square of
    // dimmed glass with a white edge and heart, in the same 44px target, with the overlay's focus ring.
    case "glass":
      return {
        target: "group/save flex size-11 items-center justify-center rounded-control focus-visible:outline-none!",
        mark: `flex size-8 items-center justify-center rounded-control border border-paper/90 text-paper backdrop-blur-sm motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-active/save:scale-90 group-focus-visible/save:ring-2 group-focus-visible/save:ring-ink group-focus-visible/save:ring-offset-2 group-focus-visible/save:ring-offset-paper ${
          // At least 45% ink, so the white heart and edge keep 3.3:1 even over a white poster (WCAG 1.4.11).
          saved ? "bg-ink/65" : "bg-ink/45 group-hover/save:bg-ink/60"
        }`,
        icon: "size-4.5",
      };
  }
}

/**
 * The save heart (docs/design/favourites-analytics.md §5.2). A toggle button
 * with a fixed name, "Save {title}", and `aria-pressed` for the state (the
 * spec's choice: one pattern, never a changing name as well). Signed out in
 * live mode it's a link to sign in that comes back and finishes the save.
 * While auth or the ids are loading it looks unsaved, is `aria-disabled` and
 * ignores taps. Renders nothing without a FavouritesProvider.
 */
export default function SaveButton({
  event,
  variant,
  className = "",
}: {
  event: SaveTarget;
  variant: SaveButtonVariant;
  className?: string;
}) {
  const favourites = useFavourites();
  if (!favourites) return null;

  const saved = favourites.status === "ready" && favourites.isSaved(event.id);
  const c = classes(variant, saved);
  const content = (
    <>
      {c.mark ? (
        <span className={c.mark}>
          <HeartIcon filled={saved} className={c.icon} />
        </span>
      ) : (
        <HeartIcon filled={saved} className={c.icon} />
      )}
      {variant === "action" && <span className={actionRowLabelClass}>Save</span>}
    </>
  );

  if (favourites.signedOut) {
    return (
      <Link
        href={withNext("/login", `/events/${event.slug}?save=1`)}
        aria-label={`Sign in to save ${event.title}`}
        className={`${c.target} ${className}`.trim()}
      >
        {content}
      </Link>
    );
  }

  // "error" stays operable: a tap explains the ids couldn't load and offers Try again.
  const waiting = favourites.status === "auth-loading" || favourites.status === "loading" || favourites.status === "idle";

  function handleClick(e: MouseEvent<HTMLButtonElement>) {
    if (waiting) {
      e.preventDefault();
      return;
    }
    favourites?.toggle(event);
  }

  return (
    <button
      type="button"
      aria-label={`Save ${event.title}`}
      aria-pressed={saved}
      aria-disabled={waiting ? true : undefined}
      onClick={handleClick}
      data-save-variant={variant}
      // No faded look: loading is a wait, not a refusal (§5.2).
      className={`${c.target} aria-disabled:cursor-wait aria-disabled:opacity-100 ${className}`.trim()}
    >
      {content}
    </button>
  );
}

"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { secondaryActionClass } from "@/components/ui/Button";
import { withNext } from "@/lib/safe-next-path";
import type { SaveTarget } from "./favourites-store";
import { useFavourites } from "./FavouritesProvider";
import HeartIcon from "./HeartIcon";

export type SaveButtonVariant = "overlay" | "plain" | "action";

const discBase = "flex size-9 items-center justify-center rounded-control border motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-active/save:scale-90";

/** The 44px hit area and the visible mark, per variant and state. */
function classes(variant: SaveButtonVariant, saved: boolean) {
  switch (variant) {
    // The event page's secondary action row, beside Share: the page's one Save.
    case "action":
      return {
        target: `group/save ${secondaryActionClass}`,
        mark: null,
        icon: "size-4 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-active/save:scale-90",
      };
    case "plain":
      return {
        target: "group/save flex size-11 items-center justify-center text-foreground",
        mark: null,
        icon: "size-5 motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-active/save:scale-90",
      };
    // On a photo, which can be dark: the page's black outline could vanish into it, so
    // keyboard focus rings the 36px mark instead, black on a white gap that shows on any
    // photo (never orange). Explicit ink/paper: it's the same on every surface and theme.
    case "overlay":
      return {
        target: "group/save flex size-11 items-center justify-center rounded-control focus-visible:outline-none!",
        mark: `${discBase} border-foreground group-focus-visible/save:ring-2 group-focus-visible/save:ring-ink group-focus-visible/save:ring-offset-2 group-focus-visible/save:ring-offset-paper ${
          saved
            ? "bg-foreground text-background group-hover/save:bg-accent-strong"
            : "bg-background text-foreground group-hover/save:ring-1 group-hover/save:ring-foreground"
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
      {variant === "action" && "Save"}
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

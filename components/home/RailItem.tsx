"use client";

import { createContext, useContext, type FocusEvent, type ReactNode } from "react";

/**
 * Marks a copy of a rail's card (`RailCloneSet`): the home rails' endless
 * auto-scroll (`useRailAutoScroll`) appends copies of the cards after the
 * real ones, so the drift never runs out.
 */
export const RAIL_CLONE_ATTR = "data-rail-clone";

const RailCloneContext = createContext(false);

/**
 * Its children's `RailItem`s render as copies: `aria-hidden` and `inert`, so
 * a copy has no tab stop and is never a second link for a screen reader
 * (only the real cards are). Renders nothing of its own.
 */
export function RailCloneSet({ children }: { children: ReactNode }) {
  return <RailCloneContext value>{children}</RailCloneContext>;
}

/**
 * Brings a keyboard-focused item fully into view: in a sideways rail the
 * browser only scrolls the focused link itself into view, which can leave
 * the rest of its card (Save, Get tickets) cut off at the edge. Keyboard
 * focus only (`:focus-visible`), so a tap or click never moves the card out
 * from under the pointer. Instant under reduced motion.
 */
export function revealFocusedItem(event: FocusEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof Element) || !target.matches(":focus-visible")) return;
  const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  event.currentTarget.scrollIntoView?.({ inline: "nearest", block: "nearest", behavior: reduce ? "auto" : "smooth" });
}

/**
 * A rail's list item that keeps a keyboard-focused card fully in view (see
 * `revealFocusedItem`). Inside a `RailCloneSet` it's a copy instead:
 * `aria-hidden`, `inert` and marked with `RAIL_CLONE_ATTR`.
 */
export default function RailItem({ className, children }: { className?: string; children: ReactNode }) {
  const clone = useContext(RailCloneContext);
  if (clone) {
    return (
      // data-rail-clone: RAIL_CLONE_ATTR.
      <li className={className} aria-hidden="true" inert data-rail-clone="">
        {children}
      </li>
    );
  }
  return (
    <li className={className} onFocus={revealFocusedItem}>
      {children}
    </li>
  );
}

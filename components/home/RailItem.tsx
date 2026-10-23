"use client";

import type { FocusEvent, ReactNode } from "react";

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

/** A rail's list item that keeps a keyboard-focused card fully in view (see `revealFocusedItem`). */
export default function RailItem({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <li className={className} onFocus={revealFocusedItem}>
      {children}
    </li>
  );
}

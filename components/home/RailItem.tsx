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
 * Its children's `RailItem`s render as copies: `aria-hidden`, with every
 * focusable element inside at `tabindex="-1"` (`keepOutOfTabOrder`), so a
 * copy has no tab stop and is never a second link for a screen reader (only
 * the real cards are), while a click or tap on it works exactly as on the
 * real card: the same links, and the same Save (one shared store, keyed by
 * the event). Renders nothing of its own.
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

/** Anything a browser can put in the tab order. */
const FOCUSABLE = "a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]";

/**
 * Takes everything focusable inside a copy out of the tab order
 * (`tabIndex = -1`): now, and again whenever its contents change (a card
 * re-rendering a button, a link appearing), so no tab stop ever lands in an
 * `aria-hidden` copy. Pointer clicks and taps still work. A ref callback;
 * returns its cleanup.
 */
export function keepOutOfTabOrder(li: HTMLElement | null): (() => void) | undefined {
  if (!li) return undefined;
  const apply = () => {
    for (const el of Array.from(li.querySelectorAll<HTMLElement>(FOCUSABLE))) {
      if (el.tabIndex !== -1) el.tabIndex = -1;
    }
  };
  apply();
  if (typeof MutationObserver === "undefined") return undefined;
  // Its own writes report a tabindex change too; by then everything is already -1, so nothing loops.
  const observer = new MutationObserver(apply);
  observer.observe(li, { subtree: true, childList: true, attributes: true, attributeFilter: ["tabindex", "href", "contenteditable"] });
  return () => observer.disconnect();
}

/**
 * A rail's list item that keeps a keyboard-focused card fully in view (see
 * `revealFocusedItem`). Inside a `RailCloneSet` it's a copy instead:
 * `aria-hidden`, nothing in it in the tab order (`keepOutOfTabOrder`), and
 * marked with `RAIL_CLONE_ATTR`; clicks and taps on it work as on the real card.
 */
export default function RailItem({ className, children }: { className?: string; children: ReactNode }) {
  const clone = useContext(RailCloneContext);
  if (clone) {
    return (
      // data-rail-clone: RAIL_CLONE_ATTR.
      <li ref={keepOutOfTabOrder} className={className} aria-hidden="true" data-rail-clone="">
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

"use client";

import { useEffect } from "react";

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";
/** Cards in a staggered group come in 60ms apart, in runs of four (a row), so none waits long. */
export const STAGGER_MS = 60;
export const STAGGER_RUN = 4;

/** The entrance delay of the `index`th child of a staggered group. */
export function staggerDelay(index: number): number {
  return (Math.max(index, 0) % STAGGER_RUN) * STAGGER_MS;
}

const PENDING = "reveal-pending";
const ARMED = "data-reveal-armed";

/**
 * Scroll and load entrances (owner request, 21 Oct 2026), for elements marked
 * `data-reveal` and for the children of `data-reveal-stagger` lists (event
 * grids, queues). Each rises 12px and fades in as it scrolls into view;
 * content that arrives later (a feed's results, the next page after a
 * navigation) comes in the same way when it's on screen.
 *
 * - What's already on screen when the page first loads is left alone, so the
 *   server-rendered first view (and its LCP h1, which is never marked) never
 *   blinks out and back in.
 * - It moves things with `transform` and `opacity` only: no layout shift.
 * - Anything that takes keyboard focus while still waiting shows at once, so
 *   focus never lands on something invisible (WCAG 2.4.7).
 * - Cleaning up (an unmount, or StrictMode's mount-unmount-mount) un-arms
 *   everything still waiting, so the next run arms it afresh rather than
 *   leaving it hidden with nothing observing it.
 * - Nothing happens for people who prefer reduced motion, without
 *   IntersectionObserver, or without JavaScript: the content just shows. It
 *   never hides anything in print either (globals.css scopes it to screens).
 */
export default function RevealObserver() {
  useEffect(() => {
    if (typeof window.matchMedia !== "function" || window.matchMedia(REDUCE_QUERY).matches) return;
    if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return;

    // Armed and still waiting to come into view.
    const pending = new Set<HTMLElement>();

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-revealed");
          io.unobserve(entry.target);
          if (entry.target instanceof HTMLElement) pending.delete(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );

    function arm(element: Element, index: number, firstLoad: boolean) {
      if (!(element instanceof HTMLElement) || element.hasAttribute(ARMED)) return;
      element.setAttribute(ARMED, "");
      if (firstLoad) {
        const rect = element.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) return;
      }
      element.style.setProperty("--reveal-d", `${staggerDelay(index)}ms`);
      element.classList.add(PENDING);
      pending.add(element);
      io.observe(element);
    }

    function scan(firstLoad: boolean) {
      document.querySelectorAll("[data-reveal]").forEach((element) => arm(element, 0, firstLoad));
      document.querySelectorAll("[data-reveal-stagger]").forEach((list) => {
        Array.from(list.children).forEach((child, index) => arm(child, index, firstLoad));
      });
    }

    // Focus reached something still waiting (Tab past the fold, a skip link, a
    // fragment): show it now, with no fade, rather than when it scrolls in.
    function revealFocused(event: FocusEvent) {
      if (!(event.target instanceof Element)) return;
      const waiting = event.target.closest(`.${PENDING}`);
      if (!(waiting instanceof HTMLElement)) return;
      io.unobserve(waiting);
      pending.delete(waiting);
      waiting.classList.remove(PENDING);
      waiting.style.removeProperty("--reveal-d");
    }

    scan(true);
    document.addEventListener("focusin", revealFocused);
    // New content is marked before the browser paints it (mutation callbacks run first),
    // so it never flashes in and then disappears.
    let queued = false;
    let active = true;
    const mo = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) scan(false);
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      active = false;
      mo.disconnect();
      io.disconnect();
      document.removeEventListener("focusin", revealFocused);
      for (const element of pending) {
        element.classList.remove(PENDING);
        element.removeAttribute(ARMED);
        element.style.removeProperty("--reveal-d");
      }
      pending.clear();
    };
  }, []);

  return null;
}

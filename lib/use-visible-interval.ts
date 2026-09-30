"use client";

import { useEffect, useRef } from "react";

export interface VisibleIntervalOptions {
  /** Off: nothing runs and nothing is scheduled. */
  enabled: boolean;
  /** Also pause while the window doesn't have focus (the tab is visible but another window is in front). */
  requireFocus?: boolean;
  /** Run once straight away when enabled (and active), rather than after the first delay. */
  immediate?: boolean;
}

/**
 * Calls `callback` every `delayMs` while the page is visible (and, with
 * `requireFocus`, focused), and pauses while it isn't. Calls never overlap:
 * the next one is scheduled when the last finishes. Coming back to the page
 * checks straight away if a full interval has passed since the last call,
 * and otherwise waits out the rest of it, so flicking between tabs can't
 * trigger a burst of requests.
 */
export function useVisibleInterval(
  callback: () => unknown,
  delayMs: number,
  { enabled, requireFocus = false, immediate = false }: VisibleIntervalOptions,
) {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let disposed = false;
    // Starting counts as a call when not immediate, so the first one waits a full interval.
    let lastRun = immediate ? -Infinity : Date.now();

    const active = () =>
      document.visibilityState === "visible" && (!requireFocus || document.hasFocus());

    function clear() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }

    function schedule(wait: number) {
      clear();
      if (disposed || running || !active()) return;
      timer = setTimeout(tick, Math.max(0, wait));
    }

    async function tick() {
      timer = undefined;
      if (disposed || running || !active()) return;
      running = true;
      lastRun = Date.now();
      try {
        await callbackRef.current();
      } catch {
        // The callback reports its own failures; a throw mustn't stop polling.
      } finally {
        running = false;
        schedule(delayMs);
      }
    }

    function resume() {
      if (!active() || running) return;
      schedule(delayMs - (Date.now() - lastRun));
    }

    function onVisibilityOrFocus() {
      if (active()) resume();
      else clear();
    }

    document.addEventListener("visibilitychange", onVisibilityOrFocus);
    window.addEventListener("focus", onVisibilityOrFocus);
    window.addEventListener("blur", onVisibilityOrFocus);
    resume();

    return () => {
      disposed = true;
      clear();
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
      window.removeEventListener("focus", onVisibilityOrFocus);
      window.removeEventListener("blur", onVisibilityOrFocus);
    };
  }, [enabled, delayMs, requireFocus, immediate]);
}

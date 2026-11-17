"use client";

import { useSyncExternalStore } from "react";

const MINUTE_MS = 60_000;

/**
 * Everyone reading the clock shares one timer: it fires on each minute's turn (events start on the
 * minute, so a label changes right when it should), and again when the page comes back into view,
 * since a phone may have slept through any number of them.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

function notify() {
  for (const listener of listeners) listener();
}

function schedule() {
  timer = setTimeout(
    () => {
      notify();
      schedule();
    },
    MINUTE_MS - (Date.now() % MINUTE_MS),
  );
}

function onVisible() {
  if (document.visibilityState === "visible") notify();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) {
    schedule();
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      clearTimeout(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/** The current minute (ms since the epoch, floored): the same number all minute long, so React re-renders only when it turns. */
const getSnapshot = () => Math.floor(Date.now() / MINUTE_MS) * MINUTE_MS;
/** The server (and hydration) have no clock to agree on: nothing, then the real minute straight after. */
const getServerSnapshot = () => null;

/**
 * The time, to the minute, in the browser only: null on the server and while hydrating, so time-dependent text
 * (the "soon" tag) never mismatches the server's HTML, then the current minute, kept current each minute.
 */
export function useMinuteNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

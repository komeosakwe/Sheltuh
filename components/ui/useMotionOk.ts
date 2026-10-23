"use client";

import { useSyncExternalStore } from "react";

/** Motion is welcome: the visitor hasn't asked their system for less of it. */
export const MOTION_OK_QUERY = "(prefers-reduced-motion: no-preference)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(MOTION_OK_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(MOTION_OK_QUERY).matches;
/** The server (and hydration) render as reduced motion, the safe default; the real value follows. */
const getServerSnapshot = () => false;

/**
 * True when the visitor hasn't asked for reduced motion, kept current if they
 * change the setting. For script-driven motion and its controls (CSS motion
 * uses Tailwind's `motion-safe:`). False on the server and without
 * `matchMedia`.
 */
export function useMotionOk(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

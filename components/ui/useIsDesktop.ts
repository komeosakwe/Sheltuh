"use client";

import { useSyncExternalStore } from "react";

/** Tailwind's `lg` (1024px) and up: the desktop layouts. */
export const DESKTOP_QUERY = "(min-width: 64rem)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
const getSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;
/** The server (and hydration) render as not-desktop; the real value follows straight after. */
const getServerSnapshot = () => false;

/**
 * True on a desktop-width viewport (≥1024px), kept current as the window
 * resizes. For content that must exist in only one place (a form rendered
 * either in a desktop panel or a phone sheet, never both, so ids and focus
 * targets stay unique).
 */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

"use client";

import { useSyncExternalStore } from "react";

/** Below Tailwind's `sm` (640px): the phone layouts. */
export const PHONE_QUERY = "(max-width: 639.98px)";

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(PHONE_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}
/** Without matchMedia (a DOM that has none: jsdom), not a phone. */
const getSnapshot = () => typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;
/** The server (and hydration) render as not-a-phone; the real value follows straight after. */
const getServerSnapshot = () => false;

/** True on a phone-width viewport, kept current as the window resizes. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

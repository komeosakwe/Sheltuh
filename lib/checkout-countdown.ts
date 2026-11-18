/**
 * The payment page's countdown (components/checkout/CheckoutCountdown.tsx):
 * time left to pay, by the server's clock. A checkout is payable for
 * CHECKOUT_PAY_MINUTES from when it starts; the API sends the deadline
 * (`expiresAt`) and its own clock (`serverTime`) on every open answer, so a
 * device whose clock is wrong still counts down to the right moment.
 */

import { CHECKOUT_PAY_MINUTES } from "@/lib/api/types";

/** The last two minutes: the countdown turns orange, with a clock icon. */
export const COUNTDOWN_URGENT_MS = 2 * 60_000;

/** The moments said to screen readers (in ms left): 5:00 and 1:00. Time's up is said too. */
const ANNOUNCE_AT_MS = [5 * 60_000, 60_000] as const;

/** The most the countdown ever shows: a checkout can't be payable for longer than its pay window. */
const MAX_SHOWN_MS = CHECKOUT_PAY_MINUTES * 60_000;

/**
 * How far the server's clock is ahead of this device's (ms; negative when
 * behind): `serverTime` against the device's clock when the answer arrived.
 * 0 without a usable `serverTime` (an older response).
 */
export function clockOffsetMs(serverTime: string | undefined, receivedAt: number): number {
  if (!serverTime) return 0;
  const server = Date.parse(serverTime);
  return Number.isFinite(server) ? server - receivedAt : 0;
}

/**
 * The deadline on this device's clock (ms since the epoch): `expiresAt` moved
 * by the offset, so `deadline - Date.now()` is the time left by the server's
 * clock. NaN for an unreadable `expiresAt`.
 */
export function localDeadline(expiresAt: string, offsetMs: number): number {
  return Date.parse(expiresAt) - offsetMs;
}

/**
 * Time left as "mm:ss" (whole seconds, rounded up, so "00:01" is the last
 * second shown before time's up). Never below "00:00", and never above the
 * pay window.
 */
export function formatCountdown(msLeft: number): string {
  const ms = Number.isFinite(msLeft) ? Math.min(Math.max(msLeft, 0), MAX_SHOWN_MS) : 0;
  const seconds = Math.ceil(ms / 1000);
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/** Whether the countdown is in its last two minutes (urgent styling). */
export function isCountdownUrgent(msLeft: number): boolean {
  return msLeft <= COUNTDOWN_URGENT_MS;
}

/** How long until the shown time next changes (it shows whole seconds, rounded up). */
export function msUntilNextSecond(msLeft: number): number {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return 0;
  return msLeft % 1000 || 1000;
}

export const COUNTDOWN_TIME_UP_ANNOUNCEMENT = "Time’s up. You haven’t been charged.";

/**
 * What screen readers are told as the time left goes from `beforeMs` to
 * `nowMs`: only on passing 5:00 or 1:00, or reaching time's up (the ticking
 * text itself isn't announced). After a jump (the device slept), only the
 * latest moment passed is said. Null otherwise.
 */
export function countdownAnnouncement(beforeMs: number, nowMs: number): string | null {
  if (nowMs >= beforeMs) return null;
  if (nowMs <= 0) return beforeMs > 0 ? COUNTDOWN_TIME_UP_ANNOUNCEMENT : null;
  let passed: number | null = null;
  for (const at of ANNOUNCE_AT_MS) {
    if (beforeMs > at && nowMs <= at) passed = at;
  }
  if (passed === null) return null;
  const minutes = passed / 60_000;
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} left to complete your order.`;
}

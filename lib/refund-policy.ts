/**
 * An event's refund policy (docs/architecture.md, "Refund policy";
 * supabase/migrations/20261109000100_event_refund_policy.sql). Plain data and
 * copy, safe on the client and the server: the editor, the event page, the
 * payment page, the ticket page and emails all say the same thing.
 *
 * Refunds themselves stay manual (made in Stripe: "Refunds made in Stripe").
 * This is what buyers are told before they pay, and what the organiser has
 * committed to.
 */

import { formatDayTime } from "./format";
import { PLATFORM_TIME_ZONE } from "./time-zones";

/**
 * - `no_change_of_mind`: no refunds for change of mind (the default, and what
 *   every event created before the policy existed has).
 * - `days_before`: refunds for any reason up to `refundDays` days before the
 *   event starts.
 */
export type RefundPolicy = "no_change_of_mind" | "days_before";

export const REFUND_POLICIES: readonly RefundPolicy[] = ["no_change_of_mind", "days_before"];

export const DEFAULT_REFUND_POLICY: RefundPolicy = "no_change_of_mind";

/** `days_before`'s range, inclusive (matches the events_refund_days_check constraint). */
export const MIN_REFUND_DAYS = 1;
export const MAX_REFUND_DAYS = 30;

/**
 * The error body's `code` (ApiError.body.code) when an edit would make the
 * refund policy of an event with orders less generous (409,
 * fieldErrors.refundPolicy). See tightensRefundPolicy.
 */
export const REFUND_POLICY_TIGHTENED_CODE = "refund_policy_tightened";

/**
 * Always true, whatever the event's own policy: the line to show beside
 * refundPolicySummary wherever a policy is shown.
 */
export const REFUND_ACL_STATEMENT =
  "You're always entitled to a refund if the event is cancelled or significantly changed, as the Australian Consumer Law requires.";

/** Whether `days` is a valid `refundDays`: a whole number from MIN_REFUND_DAYS to MAX_REFUND_DAYS. */
export function isValidRefundDays(days: unknown): days is number {
  return typeof days === "number" && Number.isInteger(days) && days >= MIN_REFUND_DAYS && days <= MAX_REFUND_DAYS;
}

/**
 * The buyer-facing sentence for a policy:
 * - `no_change_of_mind`: "No refunds for change of mind."
 * - `days_before`: "Refunds available up to 7 days before the event." ("1 day")
 *
 * `days` is ignored for `no_change_of_mind`. For `days_before` it must be
 * valid (isValidRefundDays: every stored event's is); anything else throws a
 * RangeError rather than telling buyers something untrue, so a form previewing
 * a half-typed value should check isValidRefundDays first.
 */
export function refundPolicySummary(policy: RefundPolicy, days?: number | null): string {
  if (policy === "no_change_of_mind") return "No refunds for change of mind.";
  if (!isValidRefundDays(days)) {
    throw new RangeError(`refundPolicySummary: days_before needs a whole number of days from ${MIN_REFUND_DAYS} to ${MAX_REFUND_DAYS}.`);
  }
  return `Refunds available up to ${days} ${days === 1 ? "day" : "days"} before the event.`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a `days_before` policy's refunds close: `days` × 24 hours before the
 * event starts (an exact span of time, so across a daylight-saving change
 * the clock time differs from the start's by the hour). Null for an invalid
 * start or `days`.
 */
export function refundDeadline(startsAt: string, days: number): Date | null {
  const start = Date.parse(startsAt);
  if (Number.isNaN(start) || !isValidRefundDays(days)) return null;
  return new Date(start - days * DAY_MS);
}

/** What buyers are told once a `days_before` event's refund window has closed. */
export const REFUND_WINDOW_CLOSED = "The refund window for this event has closed. No refunds for change of mind.";

export interface RefundTermsLineOptions {
  /** The event's IANA zone, for the deadline's date and time (Melbourne by default). */
  timeZone?: string;
  /** The moment to compare the deadline with (now by default). */
  now?: Date;
}

/**
 * The buyer-facing sentence for an event's policy, against its start:
 * - `no_change_of_mind`: "No refunds for change of mind."
 * - `days_before`, before the deadline (refundDeadline): "Refunds available
 *   until Sat 21 Nov, 7:00 pm (7 days before the event)." in the event's
 *   zone, with the year when it isn't `now`'s.
 * - `days_before`, from the deadline on: REFUND_WINDOW_CLOSED.
 *
 * Null (say nothing) when there's no policy, or a `days_before` without
 * valid days. A `days_before` event without a usable start falls back to
 * refundPolicySummary. Callers for which absent means the default (a
 * PublicEvent, a demo event) pass `policy ?? DEFAULT_REFUND_POLICY`.
 */
export function refundTermsLine(
  policy: RefundPolicy | null | undefined,
  days: number | null | undefined,
  startsAt: string | null | undefined,
  { timeZone = PLATFORM_TIME_ZONE, now = new Date() }: RefundTermsLineOptions = {},
): string | null {
  const summary = refundTermsSummary(policy, days);
  if (summary === null || policy !== "days_before" || !isValidRefundDays(days)) return summary;
  const deadline = startsAt ? refundDeadline(startsAt, days) : null;
  if (!deadline) return summary;
  if (now.getTime() >= deadline.getTime()) return REFUND_WINDOW_CLOSED;
  const span = `${days} ${days === 1 ? "day" : "days"} before the event`;
  return `Refunds available until ${formatDayTime(deadline.toISOString(), now, timeZone)} (${span}).`;
}

/**
 * refundPolicySummary for a policy as a payload carries it, for display:
 * null (say nothing) when there's no policy, or a `days_before` without valid
 * days, instead of throwing. Callers for which absent means the default (a
 * PublicEvent, a demo event) pass `policy ?? DEFAULT_REFUND_POLICY`.
 */
export function refundTermsSummary(policy: RefundPolicy | null | undefined, days?: number | null): string | null {
  if (policy !== "no_change_of_mind" && policy !== "days_before") return null;
  if (policy === "days_before" && !isValidRefundDays(days)) return null;
  return refundPolicySummary(policy, days);
}

/** A policy as stored: `refundDays` is set only for `days_before`. */
export interface RefundTerms {
  refundPolicy: RefundPolicy;
  refundDays?: number | null;
}

/**
 * The last moment, in days before the event, a buyer can still ask for a
 * change-of-mind refund: `refundDays` for `days_before`, none at all
 * (Infinity: the window closed before anyone bought) for
 * `no_change_of_mind`. Smaller is more generous.
 */
function refundNoticeDays(terms: RefundTerms): number {
  return terms.refundPolicy === "days_before" && typeof terms.refundDays === "number" ? terms.refundDays : Infinity;
}

/**
 * Whether going from `before` to `after` is worse for someone who already
 * bought: `days_before` → `no_change_of_mind`, or more days' notice (14 days
 * before closes the window earlier than 7 days before). Allowed changes on
 * an event with orders: `no_change_of_mind` → `days_before` (any number of
 * days), fewer days, or nothing. The database applies the same rule
 * (private.refund_policy_tightens) when an event with pending or paid orders
 * is edited.
 */
export function tightensRefundPolicy(before: RefundTerms, after: RefundTerms): boolean {
  return refundNoticeDays(after) > refundNoticeDays(before);
}

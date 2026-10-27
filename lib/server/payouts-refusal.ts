/**
 * The 409s for the database's payouts rule
 * (supabase/migrations/20261109000000_paid_events_need_payouts.sql;
 * docs/architecture.md, "Payouts before paid events"): an event with paid
 * tickets needs its organiser's payouts first.
 *
 * Keep this module light: handlers/admin.ts and handlers/event-publish.ts
 * import it, and must not load handlers/events.ts (which loads the suburb
 * table, lib/location.ts).
 */
import { PG_CHECK_VIOLATION, pgConstraint, pgErrorCode } from "./db";
import { HttpError } from "./http";

/** The error body's `code` when an event with paid tickets needs its organiser's payouts first. */
export const PAYOUTS_REQUIRED_CODE = "payouts_required";

/** The organiser's submit of an event with a paid ticket type, before their payouts are set up. */
export const PAYOUTS_REQUIRED_TO_SUBMIT =
  "Set up payouts before submitting an event with paid tickets. Free events can be submitted now.";

/** The organiser's publish (POST /api/events/{id}/publish) of an event with a paid ticket type, before their payouts are set up. */
export const PAYOUTS_REQUIRED_TO_PUBLISH =
  "Set up payouts before publishing an event with paid tickets. Free events can be published now.";

/**
 * An admin's approval, publish or ticket-type edit that would list paid
 * tickets for an organiser whose payouts aren't set up (or were turned off by
 * Stripe since they submitted).
 */
export const ADMIN_PAYOUTS_REQUIRED =
  "This organiser hasn't set up payouts, so this event can't have paid tickets while it's submitted or published. Make its tickets free, or wait until they've connected Stripe.";

/** A 409 with `code: "payouts_required"` (docs/architecture.md, "Payouts before paid events"). */
export function payoutsRequired(message: string, fieldErrors?: Record<string, string>): HttpError {
  return new HttpError(409, message, fieldErrors, { code: PAYOUTS_REQUIRED_CODE });
}

/**
 * Whether the database's payouts rule refused the write
 * (supabase/migrations/20261109000000_paid_events_need_payouts.sql): a paid
 * event moving to pending review or published, or a new paid ticket type on
 * one, while the organiser's payouts are off.
 */
export function isPayoutsRefusal(err: unknown): boolean {
  if (pgErrorCode(err) !== PG_CHECK_VIOLATION) return false;
  const constraint = pgConstraint(err);
  return constraint === "events_paid_tickets_need_payouts" || constraint === "ticket_types_paid_need_payouts";
}

/** Throws payoutsRequired(message) for the payouts rule's refusal (isPayoutsRefusal); rethrows anything else. */
export function payoutsRefused(err: unknown, message: string): never {
  if (isPayoutsRefusal(err)) throw payoutsRequired(message);
  throw err;
}

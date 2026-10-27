/**
 * Shared by the payment page (components/checkout/CheckoutPayment.tsx) and the
 * return page (components/CheckoutConfirmation.tsx): where "back" goes from a
 * card checkout, what a sold-out checkout says, and when a seat hold ends
 * (docs/design/checkout-pay.md §5.2, §5.5).
 */

import { eventZone, formatEventTime } from "@/lib/format";
import { zoneShortLabel, type StateCode } from "@/lib/time-zones";

/**
 * When a seated checkout's hold ends, as "8:31 pm Melbourne time": in the
 * event's zone (Melbourne by default), like the event's own times beside it,
 * and said so ("8:31 pm Perth time"), for a buyer whose device is set to
 * another time zone. Pass the state for the ACT's "Canberra time".
 */
export function formatHoldDeadline(isoLike: string, timeZone?: string | null, state?: StateCode | null): string {
  const zone = eventZone(timeZone);
  return `${formatEventTime(isoLike, zone)} ${zoneShortLabel(zone, state)}`;
}

/** Enough of an order to say where "back" is. */
export interface CheckoutOrderContext {
  /** The event's slug; unset when the event is gone. */
  eventSlug?: string;
  /** A reserved-seating order: back goes to the seat page. */
  seated: boolean;
}

export interface CheckoutLinkTarget {
  href: string;
  label: string;
}

export function eventPathFor(eventSlug: string): string {
  return `/events/${encodeURIComponent(eventSlug)}`;
}

/** The payment page's back link: the seat page for a seated order, else the event; home without one. */
export function checkoutBackTarget(context?: CheckoutOrderContext): CheckoutLinkTarget {
  if (!context?.eventSlug) return { href: "/", label: "Back to Sheltüh" };
  const eventPath = eventPathFor(context.eventSlug);
  return context.seated
    ? { href: `${eventPath}/seats`, label: "Change seats" }
    : { href: eventPath, label: "Back to the event" };
}

/** A closed or sold-out checkout's way out: the same place as back, in its own words; home without an event. */
export function checkoutEndedAction(context: CheckoutOrderContext, label: string): CheckoutLinkTarget {
  return context.eventSlug ? { href: checkoutBackTarget(context).href, label } : checkoutBackTarget(context);
}

export function checkoutSoldOutBody(seated: boolean): string {
  return seated
    ? "Some of your seats were booked by someone else while this checkout was open. You haven’t been charged. Choose other seats to continue."
    : "Someone else booked the last ones while this checkout was open. You haven’t been charged.";
}

/** The sold-out way out's words. */
export function checkoutSoldOutLabel(seated: boolean): string {
  return seated ? "Choose other seats" : "Back to the event";
}

/**
 * A closed checkout: its time ran out (or it was cancelled), or the event can't be booked right now
 * (unpublished or ended). The API doesn't say which, so the words cover both.
 */
export function checkoutClosedBody(seated: boolean): string {
  return seated
    ? "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged, and any seats held for you have been released."
    : "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged.";
}

/** A closed checkout's way out: the event's page, which says whether it can be booked (seated or not). */
export const CHECKOUT_CLOSED_LABEL = "Back to the event";

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
 * A closed checkout without a more particular reason: on the payment page, reason `ended` (cancelled,
 * failed, or Stripe closed it early) or none (an older response); on the return page, any closed answer
 * (its API doesn't say why). The words cover every case.
 */
export function checkoutClosedBody(seated: boolean): string {
  return seated
    ? "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged, and any seats held for you have been released."
    : "Your time to pay ran out, or this event can’t be booked right now. You haven’t been charged.";
}

/** A closed checkout's way out: the event's page, which says whether it can be booked (seated or not). */
export const CHECKOUT_CLOSED_LABEL = "Back to the event";

/** The checkout's pay window ran out (closed reason `time_up`, or the payment page's own countdown reached zero). */
export const CHECKOUT_TIME_UP_TITLE = "Time’s up";

/** Time's up: nothing was bought or charged, and (seated) the server releases the seats at the deadline. */
export function checkoutTimeUpBody(seated: boolean): string {
  return seated
    ? "Your order wasn’t placed and you haven’t been charged. Your seats have been released."
    : "Your order wasn’t placed and you haven’t been charged.";
}

/** Time's up: back to the event's tickets (its page's #tickets section, seated or not); home without an event. */
export function checkoutStartAgainTarget(context: CheckoutOrderContext): CheckoutLinkTarget {
  return context.eventSlug
    ? { href: `${eventPathFor(context.eventSlug)}#tickets`, label: "Start again" }
    : checkoutBackTarget(context);
}

/** Closed reason `unavailable`: the event can't be booked right now (unpublished, its organiser suspended, or ended). */
export const CHECKOUT_UNAVAILABLE_BODY = "This event isn’t taking bookings right now. You haven’t been charged.";

/**
 * Closed reason `unconfirmed`: the pay window is over but the server couldn't ask Stripe whether the buyer paid in
 * its last seconds. Never "you haven't been charged": the tickets may be on their way by email.
 */
export const CHECKOUT_UNCONFIRMED_TITLE = "We couldn’t confirm your payment";
export const CHECKOUT_UNCONFIRMED_BODY = "Check your email for tickets before trying again.";

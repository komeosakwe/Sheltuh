/**
 * "Support Sheltüh": an optional amount a buyer adds to a paid checkout,
 * which goes entirely to Sheltüh, the platform (docs/architecture.md,
 * "Support Sheltüh"; supabase/migrations/20261110000100_order_support.sql).
 * Plain data and copy, safe on the client and the server, so the checkout
 * UI, the API's validation, Stripe's line item and the ticket email all say
 * and allow the same thing.
 *
 * Sheltüh is a sole trader, not a charity: the copy never calls it a
 * donation, and never suggests it's tax deductible or goes to the organiser.
 * It isn't a fee either: lib/fees.ts doesn't know about it, and the booking
 * fee is never charged on it.
 */

/**
 * Whether buyers can add Support Sheltüh at checkout: only when
 * NEXT_PUBLIC_SUPPORT_SHELTUH is exactly "1" (unset, the default: paused, an
 * owner decision of 27 Oct 2026). One switch for both sides: the checkout UI
 * hides the choice, and the API refuses any `supportCents` above 0 (400
 * `fieldErrors.supportCents`, SUPPORT_PAUSED; lib/server/order-input.ts
 * parseSupportCents). Next.js inlines NEXT_PUBLIC_ variables at build time,
 * in the browser's bundle and the server's alike, so changing it takes a new
 * deployment. Orders that already carry support are untouched: their ticket
 * page, email and refunds still show and handle it.
 */
export function isSupportSheltuhEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SUPPORT_SHELTUH === "1";
}

/** The API's refusal of `supportCents` above 0 while Support Sheltüh is paused (isSupportSheltuhEnabled). */
export const SUPPORT_PAUSED = "Support Sheltüh isn't available right now";

/** The label everywhere: checkout, the payment page, Stripe's line item, the ticket page and email. */
export const SUPPORT_LABEL = "Support Sheltüh";

/** Beside the label at checkout (muted), so it's clear before the amounts that nothing has to be added. */
export const SUPPORT_OPTIONAL = "(optional)";

/** One line under the label at checkout. */
export const SUPPORT_BLURB = "Add a little to support Sheltüh's mission: keeping the creative scene discoverable.";

/** Who gets it, said plainly before the amounts (right after the blurb) and before the buyer pays. */
export const SUPPORT_RECIPIENT_NOTE = "It goes to Sheltüh, not the event organiser.";

/**
 * With the refund terms, wherever the buyer sees them on an order that has
 * support (the payment page, the ticket page, the ticket email): a partial
 * refund (of tickets) never returns it; a full refund of the order does.
 */
export const SUPPORT_REFUND_NOTE = "Support Sheltüh is refunded only if your whole order is refunded.";

/** The one-tap amounts (A$2, A$5, A$10), plus "Other". None is pre-selected; tapping the chosen one again removes it. */
export const SUPPORT_PRESETS_CENTS: readonly number[] = [200, 500, 1000];

/** The smallest amount (A$1); 0, or leaving it out, means none. */
export const SUPPORT_MIN_CENTS = 100;

/** The largest amount (A$500), also the database's limit (orders_support_cents_check). */
export const SUPPORT_MAX_CENTS = 50_000;

/**
 * Whether `value` is an amount the API takes as `supportCents`: 0 (none), or
 * a whole number of cents from SUPPORT_MIN_CENTS to SUPPORT_MAX_CENTS. Only
 * an order with a paid ticket can carry more than 0 (free orders never go
 * through Stripe).
 */
export function isValidSupportCents(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    (value === 0 || (value >= SUPPORT_MIN_CENTS && value <= SUPPORT_MAX_CENTS))
  );
}

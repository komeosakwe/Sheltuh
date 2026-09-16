import type { FeePolicy } from "./types";

/** Percentage of ticket face value charged as a booking fee. */
export const BOOKING_FEE_RATE = 0.05;
/** Flat booking fee component, in integer cents. */
export const BOOKING_FEE_FLAT_CENTS = 50;

/**
 * Booking fee for a single paid ticket: 5% of face value + A$0.50.
 * Always A$0 for a free ticket (priceCents <= 0).
 */
export function calculateBookingFeeCents(ticketPriceCents: number): number {
  if (ticketPriceCents <= 0) return 0;
  return Math.round(ticketPriceCents * BOOKING_FEE_RATE) + BOOKING_FEE_FLAT_CENTS;
}

export interface OrderSummary {
  /** Ticket face value x quantity, in integer cents. */
  subtotalCents: number;
  /** Booking fee the buyer pays, in integer cents. 0 if organiser-absorbed or free. */
  buyerFeeCents: number;
  /** subtotalCents + buyerFeeCents. */
  totalCents: number;
}

/**
 * Order summary for `quantity` tickets of a single ticket type.
 * Organiser-absorbed fees still exist economically but are never added to the
 * buyer's total, so buyerFeeCents is 0 for that policy.
 */
export function calculateOrderSummary(
  ticketPriceCents: number,
  quantity: number,
  feePolicy: FeePolicy,
): OrderSummary {
  const subtotalCents = ticketPriceCents * quantity;
  const feePerTicket = calculateBookingFeeCents(ticketPriceCents);
  const buyerFeeCents = feePolicy === "buyer-pays" ? feePerTicket * quantity : 0;
  return {
    subtotalCents,
    buyerFeeCents,
    totalCents: subtotalCents + buyerFeeCents,
  };
}

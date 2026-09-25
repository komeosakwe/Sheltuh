import type { FeePolicy } from "./types";

/**
 * Mirrors lib/fees.ts on the frontend exactly (same constants, same
 * rounding) — infra and the Next.js app are separate TypeScript projects
 * (see infra/tsconfig.json), so this is a deliberate small duplication
 * rather than a cross-project import. The backend recomputes this from the
 * event's live ticketTypes rather than ever trusting a client-submitted
 * total for a real payment amount.
 */
export const BOOKING_FEE_RATE = 0.05;
export const BOOKING_FEE_FLAT_CENTS = 50;

export function calculateBookingFeeCents(ticketPriceCents: number): number {
  if (ticketPriceCents <= 0) return 0;
  return Math.round(ticketPriceCents * BOOKING_FEE_RATE) + BOOKING_FEE_FLAT_CENTS;
}

export interface OrderSummary {
  subtotalCents: number;
  buyerFeeCents: number;
  totalCents: number;
}

export function calculateOrderSummary(ticketPriceCents: number, quantity: number, feePolicy: FeePolicy): OrderSummary {
  const subtotalCents = ticketPriceCents * quantity;
  const feePerTicket = calculateBookingFeeCents(ticketPriceCents);
  const buyerFeeCents = feePolicy === "buyer-pays" ? feePerTicket * quantity : 0;
  return { subtotalCents, buyerFeeCents, totalCents: subtotalCents + buyerFeeCents };
}

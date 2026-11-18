import { runCheckoutExpiryCron } from "@/lib/server/handlers/checkout-expiry";
import { route } from "@/lib/server/route";

// The run starts no new order after 25 seconds, and each order is two Stripe calls of 10 seconds at most (CHECKOUT_EXPIRY_RUN, lib/server/handlers/checkout-expiry.ts), so it ends within 45.
export const maxDuration = 60;

export const GET = route(runCheckoutExpiryCron);

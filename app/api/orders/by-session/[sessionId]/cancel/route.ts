import { cancelPendingOrder } from "@/lib/server/handlers/orders";
import { route } from "@/lib/server/route";

// Expiring the session is two Stripe calls of 10 seconds at most, each with one network retry (BUYER_STRIPE_REQUEST, lib/server/handlers/orders.ts).
export const maxDuration = 60;

export const POST = route(cancelPendingOrder);

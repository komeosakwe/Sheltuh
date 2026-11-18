import { getOrderPayment } from "@/lib/server/handlers/orders";
import { route } from "@/lib/server/route";

// Past the pay deadline it closes the checkout: two Stripe calls of 10 seconds at most, each with one network retry (BUYER_STRIPE_REQUEST, lib/server/handlers/orders.ts).
export const maxDuration = 60;

export const GET = route(getOrderPayment);

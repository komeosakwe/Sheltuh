import { createCheckout } from "@/lib/server/handlers/orders";
import { route } from "@/lib/server/route";

// Below the checkout attempt's 90-second lease (lib/server/checkout-attempts.ts): a lease only lapses once its
// request is gone. Stripe gets 15 seconds per try, one retry.
export const maxDuration = 60;

export const POST = route(createCheckout);

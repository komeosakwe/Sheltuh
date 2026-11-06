import { runPayoutsCron } from "@/lib/server/handlers/payouts";
import { route } from "@/lib/server/route";

// Each transfer is up to three Stripe calls of 10 seconds at most; the run stops starting transfers after 25 seconds (TRANSFER_RUN, lib/server/order-transfers.ts), so it ends within 55.
export const maxDuration = 60;

export const GET = route(runPayoutsCron);

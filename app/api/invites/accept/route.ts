import { acceptInvite } from "@/lib/server/handlers/invites";
import { route } from "@/lib/server/route";

// Sends the new organiser's welcome after the response (sendOnboardingEmailsSoon), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const POST = route(acceptInvite);

import { releaseTickets } from "@/lib/server/handlers/ticket-release";
import { route } from "@/lib/server/route";

// A waitlist may be told (sendWaitlistEmailsSoon), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const POST = route(releaseTickets);

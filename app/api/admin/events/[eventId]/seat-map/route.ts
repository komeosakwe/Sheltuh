import { adminDeleteSeatMap, adminPutSeatMap } from "@/lib/server/handlers/seating";
import { route } from "@/lib/server/route";

// Waitlist emails are sent after the response (sendWaitlistEmailsSoon), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const PUT = route(adminPutSeatMap);
export const DELETE = route(adminDeleteSeatMap);

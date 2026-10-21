import { adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { route } from "@/lib/server/route";

// Waitlist emails are sent after the response (sendWaitlistEmailsSoon), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const GET = route(adminGetEvent);
export const PATCH = route(adminUpdateEvent);

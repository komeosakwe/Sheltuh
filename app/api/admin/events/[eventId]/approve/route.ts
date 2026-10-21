import { adminApproveEvent } from "@/lib/server/handlers/admin";
import { route } from "@/lib/server/route";

// Waitlist and follower emails are sent after the response (sendPublishEmailsSoon), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const POST = route(adminApproveEvent);

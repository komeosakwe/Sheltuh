import { adminListEvents } from "@/lib/server/handlers/admin";
import { adminCreateEvent } from "@/lib/server/handlers/admin-authoring";
import { route } from "@/lib/server/route";

// Publishing on create queues follower emails, sent after the response (sendFollowerEmailsSoon), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const GET = route(adminListEvents);
export const POST = route(adminCreateEvent);

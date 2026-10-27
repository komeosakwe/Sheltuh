import { publishEvent } from "@/lib/server/handlers/event-publish";
import { route } from "@/lib/server/route";

// Follower and admin emails (or the admins' review email) are sent after the response, for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const POST = route(publishEvent);

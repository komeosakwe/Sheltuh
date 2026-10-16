import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { route } from "@/lib/server/route";

// The drain stops claiming new jobs after 30 seconds, leaving room for the last send (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const GET = route(runEmailOutboxCron);

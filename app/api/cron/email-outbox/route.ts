import { runEmailOutboxCron } from "@/lib/server/handlers/email-outbox";
import { route } from "@/lib/server/route";

// The drain stops claiming new jobs after 45 seconds (lib/server/email-outbox.ts).
export const maxDuration = 60;

export const GET = route(runEmailOutboxCron);

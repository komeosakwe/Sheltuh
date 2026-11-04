import { getHolderMessages, sendHolderMessage } from "@/lib/server/handlers/holder-messages";
import { route } from "@/lib/server/route";

// POST sends the first messages straight after the response, for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const GET = route(getHolderMessages);
export const POST = route(sendHolderMessage);

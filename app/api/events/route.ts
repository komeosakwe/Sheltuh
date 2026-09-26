import { createEventDraft } from "@/lib/server/handlers/events";
import { listPublicEvents } from "@/lib/server/handlers/public-events";
import { route } from "@/lib/server/route";

export const GET = route(listPublicEvents);
export const POST = route(createEventDraft);

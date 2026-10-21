import { recordOutboundClick } from "@/lib/server/handlers/event-views";
import { route } from "@/lib/server/route";

export const POST = route(recordOutboundClick);

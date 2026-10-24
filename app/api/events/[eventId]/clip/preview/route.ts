import { getEventClipPreview } from "@/lib/server/handlers/event-clips";
import { route } from "@/lib/server/route";

export const GET = route(getEventClipPreview);

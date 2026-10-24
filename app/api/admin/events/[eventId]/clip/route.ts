import { adminDeleteEventClip, adminPutEventClip } from "@/lib/server/handlers/event-clips";
import { route } from "@/lib/server/route";

// Attaching downloads, checks and re-uploads a clip of up to 10 MB through Supabase Storage (lib/server/handlers/event-clips.ts).
export const maxDuration = 60;

export const PUT = route(adminPutEventClip);
export const DELETE = route(adminDeleteEventClip);

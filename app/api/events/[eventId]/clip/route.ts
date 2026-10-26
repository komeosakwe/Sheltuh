import { deleteEventClip, getEventClip, putEventClip } from "@/lib/server/handlers/event-clips";
import { route } from "@/lib/server/route";

// Attaching downloads, checks and re-uploads a clip of up to 10 MB through Supabase Storage (lib/server/handlers/event-clips.ts).
export const maxDuration = 60;

export const GET = route(getEventClip);
export const PUT = route(putEventClip);
export const DELETE = route(deleteEventClip);

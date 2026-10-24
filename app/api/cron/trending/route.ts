import { runTrendingCron } from "@/lib/server/handlers/trending";
import { route } from "@/lib/server/route";

// After the response it also sweeps stale event-clip objects from Storage (sweepEventClips, lib/server/handlers/event-clips.ts).
export const maxDuration = 60;

export const GET = route(runTrendingCron);

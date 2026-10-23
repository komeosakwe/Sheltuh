import { getTrendingEvents } from "@/lib/server/handlers/trending";
import { route } from "@/lib/server/route";

export const GET = route(getTrendingEvents);

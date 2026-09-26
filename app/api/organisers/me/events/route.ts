import { listMyEvents } from "@/lib/server/handlers/events";
import { route } from "@/lib/server/route";

export const GET = route(listMyEvents);

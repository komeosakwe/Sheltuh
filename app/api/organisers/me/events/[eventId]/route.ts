import { getMyEvent } from "@/lib/server/handlers/events";
import { route } from "@/lib/server/route";

export const GET = route(getMyEvent);

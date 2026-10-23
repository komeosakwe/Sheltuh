import { adminGetEventCuration, adminSetEventCuration } from "@/lib/server/handlers/trending";
import { route } from "@/lib/server/route";

export const GET = route(adminGetEventCuration);
export const PUT = route(adminSetEventCuration);

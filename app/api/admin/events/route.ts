import { adminListEvents } from "@/lib/server/handlers/admin";
import { adminCreateEvent } from "@/lib/server/handlers/admin-authoring";
import { route } from "@/lib/server/route";

export const GET = route(adminListEvents);
export const POST = route(adminCreateEvent);

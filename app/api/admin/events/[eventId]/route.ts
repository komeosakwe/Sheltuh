import { adminGetEvent, adminUpdateEvent } from "@/lib/server/handlers/admin-authoring";
import { route } from "@/lib/server/route";

export const GET = route(adminGetEvent);
export const PATCH = route(adminUpdateEvent);

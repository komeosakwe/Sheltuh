import { getUnreadCount } from "@/lib/server/handlers/messages";
import { route } from "@/lib/server/route";

export const GET = route(getUnreadCount);

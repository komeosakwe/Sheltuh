import { unsubscribeFollow } from "@/lib/server/handlers/follows";
import { route } from "@/lib/server/route";

export const POST = route(unsubscribeFollow);

import { markConversationRead } from "@/lib/server/handlers/messages";
import { route } from "@/lib/server/route";

export const POST = route(markConversationRead);

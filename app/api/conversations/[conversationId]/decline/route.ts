import { declineConversation } from "@/lib/server/handlers/messages";
import { route } from "@/lib/server/route";

export const POST = route(declineConversation);

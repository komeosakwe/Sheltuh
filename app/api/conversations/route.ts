import { listConversations, startConversation } from "@/lib/server/handlers/messages";
import { route } from "@/lib/server/route";

export const GET = route(listConversations);
export const POST = route(startConversation);

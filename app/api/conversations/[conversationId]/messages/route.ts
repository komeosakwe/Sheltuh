import { getMessages, sendMessage } from "@/lib/server/handlers/messages";
import { route } from "@/lib/server/route";

export const GET = route(getMessages);
export const POST = route(sendMessage);

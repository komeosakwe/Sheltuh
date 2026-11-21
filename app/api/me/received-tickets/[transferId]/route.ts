import { getReceivedTicket } from "@/lib/server/handlers/ticket-transfers";
import { route } from "@/lib/server/route";

export const GET = route(getReceivedTicket);

import { setTicketLock } from "@/lib/server/handlers/ticket-lock";
import { route } from "@/lib/server/route";

export const PUT = route(setTicketLock);

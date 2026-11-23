import { cancelTicketTransfer } from "@/lib/server/handlers/ticket-transfers";
import { route } from "@/lib/server/route";

export const POST = route(cancelTicketTransfer);

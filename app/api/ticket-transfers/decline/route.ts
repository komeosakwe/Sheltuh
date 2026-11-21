import { declineTicketOffer } from "@/lib/server/handlers/ticket-transfers";
import { route } from "@/lib/server/route";

// Room for the sender's email sent after the response (ticketTransferJobsSoon, lib/server/ticket-transfers.ts), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const POST = route(declineTicketOffer);

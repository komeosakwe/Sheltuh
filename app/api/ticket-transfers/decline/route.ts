import { declineTicketOffer } from "@/lib/server/handlers/ticket-transfers";
import { route } from "@/lib/server/route";

// For PR-2: room for the sender's declined email sent after the response (ticketTransferJobsSoon, lib/server/ticket-transfers.ts, empty until then), for up to 30 seconds (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const POST = route(declineTicketOffer);

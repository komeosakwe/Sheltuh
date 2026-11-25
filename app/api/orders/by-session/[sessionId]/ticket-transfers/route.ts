import { sendTicket } from "@/lib/server/handlers/ticket-transfers";
import { route } from "@/lib/server/route";

// Sends the offer email (and an expired notice for an overdue offer the send replaced) after the response (ticketTransferJobsSoon, lib/server/ticket-transfers.ts): the five transfer kinds in one run sharing one 30-second budget (DRAIN_BUDGET_MS, lib/server/email-outbox.ts).
export const maxDuration = 60;

export const POST = route(sendTicket);

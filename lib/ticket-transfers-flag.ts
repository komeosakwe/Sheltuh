/**
 * Sending tickets to someone (docs/architecture.md, "Ticket transfers") is
 * dark-launched behind NEXT_PUBLIC_TICKET_TRANSFERS (.env.example): "1" lets
 * a ticket's buyer send it (the ticket page's "Send ticket", and the API's
 * send route). Anything else hides sending, and the send route is a 404.
 *
 * Sending only. An offer already made can still be accepted, declined or
 * cancelled, a ticket already received keeps working at the door, and a
 * sent ticket stays sent, whatever the flag says, so switching it off never
 * strands a recipient.
 *
 * A literal `process.env.NEXT_PUBLIC_…` reference, read when called: Next
 * inlines it at build time (redeploy after changing it), and tests can stub it.
 */
export function ticketTransfersEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TICKET_TRANSFERS === "1";
}

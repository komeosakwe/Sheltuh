/**
 * The owner's rules for sending a ticket to someone (docs/architecture.md,
 * "Ticket transfers"), one constant each. The server passes every value to
 * the database functions as a parameter (the database enforces them), so
 * changing a rule is a one-line change here, with no migration. The UI reads
 * them for its copy. The two durations are Postgres intervals (and
 * RateWindow strings, lib/server/http.ts).
 */
export const TICKET_TRANSFER_RULES = {
  /** Paid tickets may be sent. */
  allowPaid: true,
  /** Free (A$0) tickets may be sent. */
  allowFree: true,
  /** No send or accept from the event's start less this. */
  cutoffBeforeStart: "2 hours",
  /** An offer lasts this long, or until the cut-off if that's sooner. */
  pendingFor: "72 hours",
  /** "Once per ticket": how many times a ticket can be accepted. */
  maxAcceptedPerTicket: 1,
  /** Whether a recipient may send the ticket on (also needs maxAcceptedPerTicket of 2 or more). */
  recipientMayResend: false,
  /** Whether the sender may cancel an offer before it's accepted. */
  senderMayCancel: true,
} as const;

/**
 * How many tickets one account can hold by transfer for one event (the accept page says so when it's
 * reached). The server passes it to the database as the accept's cap.
 */
export const MAX_HELD_TICKETS_PER_EVENT = 10;

/**
 * The eight states of UI / Ticket card · 1120 (components/tickets/TicketCard.tsx). The first four are current
 * tickets; the last four are past. Here, not in the component, so lib/ code (lib/my-tickets.ts) can name them.
 */
export type TicketCardState =
  | "active"
  | "transfer_pending"
  | "checked_in"
  | "changed"
  | "transferred"
  | "cancelled"
  | "refunded"
  | "ended";

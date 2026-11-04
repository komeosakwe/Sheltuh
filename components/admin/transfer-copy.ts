import type { AdminTransfer, TransferAction, TransferStatus } from "@/lib/api/types";

/** Each status in words, for the filter chips and each transfer's line. */
export const TRANSFER_STATUS_LABEL: Record<TransferStatus, string> = {
  failed: "Failed",
  held: "Held",
  retry: "Retrying",
  sending: "Sending now",
  sent: "Sent",
  cancelled: "Cancelled",
};

/** The statuses the default "open" view holds: not sent, not cancelled. */
export const OPEN_TRANSFER_STATUSES: readonly TransferStatus[] = ["failed", "held", "retry", "sending"];

/** `lastError` codes (never a Stripe message) in short words. Anything else is made readable. */
const ERROR_WORDS: Record<string, string> = {
  refunded: "Refunded",
  partly_refunded: "Partly refunded",
  disputed: "Disputed",
  balance_insufficient: "Not enough in the Stripe balance",
  destination_account: "Organiser’s Stripe account can’t receive",
  no_charge: "No payment found",
  charge_not_successful: "The payment didn’t go through",
  amount_mismatch: "Amount doesn’t match the payment",
  destination_charge: "Paid straight to the organiser",
  metadata_mismatch: "Payment belongs to another order",
  transfer_reversed: "Already reversed in Stripe",
  transfer_mismatch: "A different transfer exists in Stripe",
  idempotency_conflict: "Stripe rejected a repeat request",
  stripe_access: "Sheltüh can’t reach Stripe with its keys",
  rate_limited: "Stripe is busy",
  stripe_unreachable: "Couldn’t reach Stripe",
  stripe_unknown_outcome: "Stripe didn’t answer",
  rejected_by_stripe: "Stripe turned it down",
  lease_lapsed: "The attempt stalled before sending",
  last_attempt_unfinished: "The last attempt didn’t finish",
  cancelled_by_admin: "Cancelled by an admin",
};

export function transferErrorWords(code: string): string {
  const known = ERROR_WORDS[code];
  if (known) return known;
  const words = code.replace(/^rejected_/, "stripe turned it down: ").replace(/_/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown";
}

/** The actions that apply to a transfer in this status (the server's rules, so no button is offered that would be refused). */
export function transferActions(status: TransferStatus): TransferAction[] {
  switch (status) {
    case "failed":
    case "retry":
      return ["retry", "cancel"];
    case "held":
      return ["release", "cancel"];
    default:
      return [];
  }
}

export const TRANSFER_ACTION_LABEL: Record<TransferAction, string> = {
  retry: "Retry",
  release: "Release",
  cancel: "Cancel",
};

/** Whether a transfer with this status belongs in the view (`open` or one status). */
export function inTransferView(view: TransferStatus | "open", status: TransferStatus): boolean {
  return view === "open" ? OPEN_TRANSFER_STATUSES.includes(status) : view === status;
}

export function transferHeadingId(transfer: AdminTransfer) {
  return `transfer-${transfer.transferId}`;
}

import type { PaymentExceptionDetails, PaymentExceptionKind } from "@/lib/api/types";
import { subjectLine, type EmailMessage } from "./email";

/**
 * The ops alert about one payment exception (docs/architecture.md, "Refunds
 * made in Stripe"), sent to OPS_ALERT_EMAIL. Deliberately thin: the order's
 * short reference, amounts, statuses and Stripe's event id. Never the buyer's
 * address, the order id (the confirmation page's credential) or the payment
 * intent: the admin API (GET /api/admin/payment-exceptions) has the rest.
 */
export interface OpsAlert {
  kind: PaymentExceptionKind;
  /** The order's short reference ("#7C1F2E0A"), when the payment is matched to an order. */
  reference?: string;
  orderStatus?: string;
  /** The order was voided but its refund didn't complete. */
  urgent: boolean;
  details: PaymentExceptionDetails;
  stripeEventId?: string;
  openedAt: Date;
}

const TITLES: Record<PaymentExceptionKind, string> = {
  refund_not_completed: "Refund not completed",
  partial_refund: "Partial refund",
  manual_refund_required: "Manual refund required",
};

const ACTIONS: Record<PaymentExceptionKind, string> = {
  refund_not_completed:
    "Check the refund in the Stripe dashboard. If the buyer hasn't been repaid, refund them again there " +
    "(nothing is refunded or restored automatically), then resolve the exception with a note.",
  partial_refund:
    "The order stays paid and its tickets stay valid. Decide whether to refund the rest in the Stripe " +
    "dashboard (that voids the order), then resolve the exception with a note.",
  manual_refund_required:
    "The automatic refund couldn't be requested. Refund the payment in the Stripe dashboard, " +
    "then resolve the exception with a note.",
};

function dollars(cents: number): string {
  return `A$${(cents / 100).toFixed(2)}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Only Stripe's own id shapes reach the email. */
function stripeEventId(value: string | undefined): string | undefined {
  return value && /^evt_[A-Za-z0-9_]{1,250}$/.test(value) ? value : undefined;
}

export function opsAlertLines(alert: OpsAlert): string[] {
  const { details } = alert;
  const lines: string[] = [];
  if (alert.urgent) {
    lines.push("URGENT: the order was voided (its tickets are void) but the refund didn't complete.");
  }
  lines.push(`Order: ${alert.reference ?? "not matched to an order yet"}`);
  if (alert.orderStatus ?? details.orderStatus) lines.push(`Order status: ${alert.orderStatus ?? details.orderStatus}`);
  if (details.refundStatus) lines.push(`Refund status: ${details.refundStatus}`);
  if (details.refundAmountCents !== undefined) lines.push(`Refund amount: ${dollars(details.refundAmountCents)}`);
  if (details.amountRefundedCents !== undefined) lines.push(`Refunded so far: ${dollars(details.amountRefundedCents)}`);
  if (details.totalCents !== undefined) lines.push(`Order total: ${dollars(details.totalCents)}`);
  if (details.source) lines.push(`Refund made by: ${details.source === "sheltuh" ? "Sheltüh (automatic)" : "the Stripe dashboard"}`);
  const eventId = stripeEventId(alert.stripeEventId);
  if (eventId) lines.push(`Stripe event: ${eventId}`);
  lines.push(`Opened: ${alert.openedAt.toISOString()}`);
  return lines;
}

export function buildOpsAlertEmail(to: string, alert: OpsAlert, siteUrl: string): EmailMessage {
  const title = TITLES[alert.kind];
  const subject = subjectLine(
    `${alert.urgent ? "URGENT: " : ""}Sheltüh payment exception: ${title}${alert.reference ? ` ${alert.reference}` : ""}`,
  );
  const lines = opsAlertLines(alert);
  const action = ACTIONS[alert.kind];
  const where = `Open exceptions: GET ${siteUrl}/api/admin/payment-exceptions (admin sign-in).`;
  const text = [title, "", ...lines, "", action, "", where, ""].join("\n");
  const html =
    `<p><strong>${escapeHtml(title)}</strong></p>` +
    `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` +
    `<p>${escapeHtml(action)}</p><p>${escapeHtml(where)}</p>`;
  return { to, subject, text, html };
}

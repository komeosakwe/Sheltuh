"use client";

import { useMemo, useState } from "react";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { createCheckoutSession } from "@/lib/api/orders";
import { calculateOrderSummary, sumOrderSummaries } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { formatTicketBreakdown, formatTicketHeadline } from "@/lib/pricing";
import type { SheltuhEvent, TicketType } from "@/lib/types";

const MAX_QUANTITY_PER_TYPE = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const stepperButtonClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded border border-surface-border text-lg font-semibold text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-surface-border disabled:hover:text-foreground";

export default function TicketSelector({ event }: { event: SheltuhEvent }) {
  const ticketTypes = event.ticketTypes;
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyerEmail, setBuyerEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);

  // Only live events (which carry an organiserId) can be checked out —
  // demo sample events never have one, since there's no backend to check
  // out against.
  const canCheckout = isApiConfigured && Boolean(event.organiserId);

  function capFor(ticket: TicketType): number {
    return Math.min(ticket.quantityAvailable, MAX_QUANTITY_PER_TYPE);
  }

  function setQuantity(ticket: TicketType, value: number) {
    const clamped = Math.max(0, Math.min(value, capFor(ticket)));
    setQuantities((prev) => ({ ...prev, [ticket.id]: clamped }));
  }

  const lineSummaries = useMemo(
    () =>
      ticketTypes.map((ticket) => {
        const quantity = quantities[ticket.id] ?? 0;
        return {
          ticket,
          quantity,
          summary: calculateOrderSummary(ticket.priceCents, quantity, ticket.feePolicy),
        };
      }),
    [ticketTypes, quantities],
  );

  const orderTotal = sumOrderSummaries(lineSummaries.map((line) => line.summary));

  const hasAnyTickets = lineSummaries.some((line) => line.quantity > 0);
  // Paid orders give Stripe an email at checkout; free ones skip Stripe, so
  // this is the only way their tickets can reach the buyer.
  const needsEmail = canCheckout && hasAnyTickets && orderTotal.totalCents === 0;

  async function handleCheckout() {
    if (!event.organiserId) return;
    setError(null);
    setEmailError(null);
    if (needsEmail && !EMAIL_REGEX.test(buyerEmail.trim())) {
      setEmailError("Enter the email address to send your tickets to.");
      return;
    }
    setLoading(true);
    try {
      const lineItems = lineSummaries
        .filter((line) => line.quantity > 0)
        .map((line) => ({ ticketTypeId: line.ticket.id, quantity: line.quantity }));
      const result = await createCheckoutSession(event.id, lineItems, needsEmail ? buyerEmail.trim() : undefined);
      window.location.href = result.url;
      // Deliberately no setLoading(false) here — the page is navigating
      // away, and re-enabling the button would just invite a double-click.
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors?.buyerEmail) {
        setEmailError(err.fieldErrors.buyerEmail);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't start checkout. Try again.");
      }
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <ul className="flex flex-col gap-4">
        {lineSummaries.map(({ ticket, quantity }) => {
          const cap = capFor(ticket);
          const breakdown = formatTicketBreakdown(ticket);
          return (
            <li
              key={ticket.id}
              className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex-1">
                <p className="font-semibold text-foreground">{ticket.name}</p>
                {ticket.description && (
                  <p className="text-sm text-muted">{ticket.description}</p>
                )}
                <p className="mt-1 text-sm text-foreground">{formatTicketHeadline(ticket)}</p>
                {quantity > 0 && breakdown && (
                  <p className="mt-0.5 text-xs text-muted">{breakdown}</p>
                )}
              </div>
              <div
                role="group"
                aria-label={`Quantity for ${ticket.name}`}
                className="flex items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => setQuantity(ticket, quantity - 1)}
                  disabled={quantity <= 0}
                  aria-label={`Decrease quantity for ${ticket.name}`}
                  className={stepperButtonClass}
                >
                  &minus;
                </button>
                <span
                  aria-live="polite"
                  className="w-8 text-center text-base font-medium tabular-nums text-foreground"
                >
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(ticket, quantity + 1)}
                  disabled={quantity >= cap}
                  aria-label={`Increase quantity for ${ticket.name}`}
                  className={stepperButtonClass}
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <h3 className="font-heading text-xl text-foreground">Order summary</h3>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Ticket subtotal</dt>
            <dd className="text-foreground">{formatAud(orderTotal.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Booking fees (you pay)</dt>
            <dd className="text-foreground">{formatAud(orderTotal.buyerFeeCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-surface-border pt-2 font-semibold">
            <dt className="text-foreground">Total</dt>
            <dd className="text-foreground">{formatAud(orderTotal.totalCents)}</dd>
          </div>
        </dl>

        {canCheckout ? (
          <>
            {needsEmail && (
              <div className="mt-4 flex flex-col gap-1">
                <label htmlFor="buyer-email" className="text-sm font-medium text-foreground">
                  Email for your tickets
                </label>
                <input
                  id="buyer-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={buyerEmail}
                  onChange={(e) => setBuyerEmail(e.target.value)}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? "buyer-email-error" : "buyer-email-hint"}
                  className="rounded border border-surface-border bg-background px-3 py-2 text-foreground"
                />
                {emailError ? (
                  <p id="buyer-email-error" role="alert" className="text-sm text-danger">
                    {emailError}
                  </p>
                ) : (
                  <p id="buyer-email-hint" className="text-xs text-muted">
                    We&rsquo;ll only use this to send your tickets.
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={handleCheckout}
              disabled={!hasAnyTickets || loading}
              className="mt-4 w-full rounded bg-accent px-4 py-3 font-medium text-accent-foreground transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Redirecting to checkout…" : orderTotal.totalCents === 0 ? "Get free tickets" : "Checkout"}
            </button>
            {error && (
              <p role="alert" className="mt-2 text-sm text-danger">
                {error}
              </p>
            )}
            <p className="mt-2 text-xs text-muted">
              {orderTotal.totalCents === 0
                ? "Free tickets are issued immediately, no payment step."
                : "You'll pay securely on Stripe's own checkout page."}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled
              aria-disabled="true"
              className="mt-4 w-full cursor-not-allowed rounded bg-surface-border px-4 py-3 font-medium text-muted"
            >
              Checkout unavailable in this demo
            </button>
            <p className="mt-2 text-xs text-muted">
              This is a local prototype. No payment information is collected and no tickets are
              issued{hasAnyTickets ? " — the total above is a preview only." : "."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

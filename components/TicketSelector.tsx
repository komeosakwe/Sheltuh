"use client";

import { useMemo, useState } from "react";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { createCheckoutSession } from "@/lib/api/orders";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { calculateOrderSummary, sumOrderSummaries } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { formatTicketBreakdown, formatTicketHeadline } from "@/lib/pricing";
import type { SheltuhEvent, TicketType } from "@/lib/types";

const MAX_QUANTITY_PER_TYPE = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Phone and tablet sizing comes first in each class list below; the `lg:` classes
// put desktop back exactly as it was (the mobile spec leaves desktop unchanged).

const stepperButtonClass =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-foreground text-lg font-semibold text-foreground transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-surface-border disabled:hover:text-foreground";

export default function TicketSelector({ event }: { event: SheltuhEvent }) {
  const ticketTypes = event.ticketTypes;
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Signed in: the account's email is the default, since a ticket booked
  // with it is also what lets them add themselves to Who's Going. Whatever
  // they type replaces it. (Read optionally: this also renders without auth.)
  const auth = useOptionalAuth();
  const accountEmail = auth?.status === "signed-in" ? auth.email : undefined;
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const buyerEmail = typedEmail ?? accountEmail ?? "";
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
      // Free orders send the email typed (or prefilled) above. Paid orders
      // send the account email when signed in, so Stripe prefills it and the
      // tickets are booked with the email that Who's Going matches on.
      const email = needsEmail ? buyerEmail.trim() : accountEmail;
      const result = await createCheckoutSession(event.id, lineItems, email);
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
              className="flex flex-col gap-4 bg-surface p-4 sm:flex-row sm:items-center sm:justify-between lg:gap-3"
            >
              <div className="flex-1">
                <p className="text-base font-semibold text-foreground">{ticket.name}</p>
                {ticket.description && (
                  <p className="text-sm text-muted">{ticket.description}</p>
                )}
                {/* The all-inclusive price: the loudest thing in the row on phones. */}
                <p className="mt-1 text-base font-semibold tabular-nums text-foreground lg:text-sm lg:font-normal lg:normal-nums">
                  {formatTicketHeadline(ticket)}
                </p>
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
                  className="w-10 text-center text-lg font-medium tabular-nums text-foreground lg:w-8 lg:text-base"
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

      <div className="bg-surface p-4">
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
          <div className="flex justify-between border-t border-surface-border pt-2 text-base font-semibold lg:text-sm">
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
                  onChange={(e) => setTypedEmail(e.target.value)}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? "buyer-email-error" : "buyer-email-hint"}
                  // 16px text so iOS doesn't zoom on focus, and a 48px target.
                  className="min-h-12 border border-foreground bg-transparent px-3 py-2 text-base text-foreground lg:min-h-0"
                />
                {emailError ? (
                  <p id="buyer-email-error" role="alert" className="text-sm text-danger">
                    {emailError}
                  </p>
                ) : (
                  <p id="buyer-email-hint" className="text-xs text-muted">
                    We&rsquo;ll send your tickets here. Booking with your Sheltüh account email
                    also lets you add yourself to Who&rsquo;s Going.
                  </p>
                )}
              </div>
            )}
            {orderTotal.totalCents > 0 && accountEmail && (
              <p className="mt-4 text-xs text-muted">
                Booking as {accountEmail}, your account email, so you can add yourself to Who&rsquo;s Going.
              </p>
            )}
            <button
              type="button"
              onClick={handleCheckout}
              disabled={!hasAnyTickets || loading}
              className="btn btn-solid btn-lg mt-4 w-full lg:px-6 lg:py-2.5 lg:text-xs/4.5"
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
              className="mt-4 w-full cursor-not-allowed rounded-full bg-surface-border px-4 py-3 font-medium text-muted"
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@/components/ui/Section";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { createCheckoutSession } from "@/lib/api/orders";
import { MAX_FREE_TICKETS_PER_ORDER } from "@/lib/api/types";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { calculateOrderSummary, describeBookingFee, sumOrderSummaries } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { formatTicketBreakdown, formatTicketHeadline } from "@/lib/pricing";
import { getTrackingRef } from "@/lib/tracking-ref";
import type { SheltuhEvent, TicketType } from "@/lib/types";

const MAX_QUANTITY_PER_TYPE = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The steppers use aria-disabled, not `disabled`: reaching 0 or the cap must
// leave focus on the button rather than dropping it to <body>.
const stepperButtonClass =
  "flex size-11 shrink-0 items-center justify-center rounded-control border border-foreground bg-card text-lg font-semibold text-foreground transition-colors hover:bg-surface aria-disabled:cursor-not-allowed aria-disabled:border-surface-border aria-disabled:text-muted aria-disabled:hover:bg-card";

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
  // A free order waiting on its emailed confirmation link: the address it went to.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  // Set by "Use a different email": once the email field is back, focus it.
  const focusEmailField = useRef(false);

  useEffect(() => {
    if (sentTo) {
      sentHeadingRef.current?.focus();
    } else if (focusEmailField.current) {
      focusEmailField.current = false;
      emailInputRef.current?.focus();
    }
  }, [sentTo]);

  // Only live events (which carry an organiserId) can be checked out —
  // demo sample events never have one, since there's no backend to check
  // out against.
  const canCheckout = isApiConfigured && Boolean(event.organiserId);

  // Free tickets: at most MAX_FREE_TICKETS_PER_ORDER in total per booking,
  // across every free type, whether or not paid tickets are in it too (the
  // checkout API refuses anything more with a 400).
  const freeTypeCount = ticketTypes.filter((t) => t.priceCents === 0).length;
  const freeChosen = ticketTypes.reduce((n, t) => n + (t.priceCents === 0 ? (quantities[t.id] ?? 0) : 0), 0);
  const freeLimitReached = freeChosen >= MAX_FREE_TICKETS_PER_ORDER;

  function capFor(ticket: TicketType): number {
    const cap = Math.min(ticket.quantityAvailable, MAX_QUANTITY_PER_TYPE);
    if (ticket.priceCents > 0) return cap;
    return Math.min(cap, MAX_FREE_TICKETS_PER_ORDER - (freeChosen - (quantities[ticket.id] ?? 0)));
  }

  function setQuantity(ticket: TicketType, value: number) {
    const clamped = Math.max(0, Math.min(value, capFor(ticket)));
    // A press on a stepper that's at its limit (aria-disabled, so still
    // clickable) changes nothing, and keeps any message on screen.
    if (clamped === (quantities[ticket.id] ?? 0)) return;
    setQuantities((prev) => ({ ...prev, [ticket.id]: clamped }));
    // A refusal was about the old selection.
    setError(null);
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
  // Every ticket free: no payment step, but an emailed confirmation link.
  const allFree = ticketTypes.every((t) => t.priceCents === 0);
  const steps = allFree
    ? ["Choose tickets", "Confirm by email", "Tickets"]
    : ["Choose tickets", "Pay on Stripe", "Tickets by email"];
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
      // The tracking link they arrived through, if any (attribution only).
      // A free order sends the account's token when signed in: booked with
      // the account's own verified email, the API can issue the tickets
      // without a confirmation link (it decides; we handle both outcomes).
      const result = await createCheckoutSession(
        event.id,
        lineItems,
        email,
        getTrackingRef(event.id),
        needsEmail && auth?.status === "signed-in" ? auth.getAccessToken : undefined,
      );
      if ("url" in result) {
        window.location.href = result.url;
        // Deliberately no setLoading(false) here — the page is navigating
        // away, and re-enabling the button would just invite a double-click.
        return;
      }
      setSentTo(email ?? "");
      setLoading(false);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        // The email has its own field; anything else (such as too many free
        // tickets in `lineItems`) has no field to highlight, so it's said in
        // full rather than as "fix the highlighted fields".
        const { buyerEmail: emailMessage, ...others } = err.fieldErrors;
        if (emailMessage) setEmailError(emailMessage);
        const otherMessages = Object.values(others).filter(Boolean).join(" ");
        if (otherMessages || !emailMessage) setError(otherMessages || err.message);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't start checkout. Try again.");
      }
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-card border border-foreground bg-card p-4 sm:p-5">
      {/* What happens next, before anything is chosen (static: no progress bar). */}
      {canCheckout && (
        <div className="flex flex-col gap-1">
          <ol aria-label="How booking works" className="eyebrow flex flex-wrap gap-x-3 gap-y-1">
            {steps.map((step, i) => (
              <li
                key={step}
                aria-current={i === 0 ? "step" : undefined}
                className={`flex gap-x-3 ${i === 0 ? "text-foreground" : "text-muted"}`}
              >
                {i > 0 && <span aria-hidden="true">&rarr;</span>}
                <span>
                  {i + 1} {step}
                </span>
              </li>
            ))}
          </ol>
          {allFree && (
            <p className="text-xs text-muted">Signed in with a verified email? Step 2 is usually skipped.</p>
          )}
        </div>
      )}

      <p className="text-sm text-muted">Booking fee: {describeBookingFee()}. Free tickets never carry a fee.</p>

      {/* Before the tickets, so the limit is known before choosing. */}
      {freeTypeCount > 0 && (
        <p id="free-ticket-limit" aria-live="polite" className="text-xs text-muted">
          {freeLimitReached
            ? `That's the most free tickets one booking can have (${MAX_FREE_TICKETS_PER_ORDER}${freeTypeCount > 1 ? " in total, across the free ticket types" : ""}).`
            : `Up to ${MAX_FREE_TICKETS_PER_ORDER} free tickets per booking${freeTypeCount > 1 ? ", in total across the free ticket types" : ""}.`}
        </p>
      )}

      <ul className="flex flex-col">
        {lineSummaries.map(({ ticket, quantity }) => {
          const cap = capFor(ticket);
          const breakdown = formatTicketBreakdown(ticket);
          return (
            <li
              key={ticket.id}
              className="flex flex-col gap-3 border-t border-surface-border py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-base leading-snug font-semibold text-foreground">{ticket.name}</p>
                {/* The all-inclusive price per ticket comes first and is the loudest
                    number, at every width (ACCC: brand-direction-one.md §6.8). */}
                <p className="mt-1 text-base leading-6 font-semibold tabular-nums text-foreground">
                  {formatTicketHeadline(ticket)}
                </p>
                {ticket.description && <p className="mt-1 text-sm text-muted">{ticket.description}</p>}
                {/* What makes up the total, before anything is chosen. Never louder than it. */}
                {breakdown && <p className="meta mt-1 text-muted">{breakdown}</p>}
              </div>
              <div
                role="group"
                aria-label={`Quantity for ${ticket.name}`}
                className="flex shrink-0 items-center gap-2"
              >
                <button
                  type="button"
                  onClick={() => setQuantity(ticket, quantity - 1)}
                  aria-disabled={quantity <= 0}
                  aria-label={`Decrease quantity for ${ticket.name}`}
                  className={stepperButtonClass}
                >
                  &minus;
                </button>
                <span aria-live="polite" className="w-10 text-center text-lg leading-6 font-semibold tabular-nums text-foreground">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(ticket, quantity + 1)}
                  aria-disabled={quantity >= cap}
                  aria-label={`Increase quantity for ${ticket.name}`}
                  aria-describedby={ticket.priceCents === 0 ? "free-ticket-limit" : undefined}
                  className={stepperButtonClass}
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-foreground pt-4">
        <h3 className="eyebrow text-muted">Order summary</h3>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Tickets</dt>
            <dd className="tabular-nums text-foreground">{formatAud(orderTotal.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Booking fees</dt>
            <dd className="tabular-nums text-foreground">{formatAud(orderTotal.buyerFeeCents)}</dd>
          </div>
          {/* The total is the largest number in the panel. */}
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-foreground pt-3">
            <dt className="text-lg leading-6 font-bold text-foreground">Total</dt>
            <dd className="text-xl leading-7 font-bold tabular-nums text-foreground">
              {formatAud(orderTotal.totalCents)}
            </dd>
          </div>
        </dl>

        {canCheckout && sentTo !== null ? (
          <div className="mt-4 flex flex-col gap-2">
            <h4 ref={sentHeadingRef} tabIndex={-1} className="font-heading text-xl text-foreground outline-offset-2">
              Check your inbox
            </h4>
            <p role="status" className="text-sm text-foreground">
              We&rsquo;ve emailed a link to <span className="break-all font-semibold">{sentTo}</span>. Open it and
              press Confirm to get your tickets. The link works for 24 hours.
            </p>
            <p className="text-xs text-muted">
              Nothing there after a few minutes? Check your spam folder. Your tickets aren&rsquo;t held until you
              confirm.
            </p>
            <button
              type="button"
              onClick={() => {
                focusEmailField.current = true;
                setSentTo(null);
              }}
              className="btn btn-outline mt-2 min-h-11 w-full lg:w-auto"
            >
              Use a different email
            </button>
          </div>
        ) : canCheckout ? (
          <>
            {needsEmail && (
              <div className="mt-4 flex flex-col gap-1">
                <label htmlFor="buyer-email" className="eyebrow text-muted">
                  Email for your tickets
                </label>
                <input
                  ref={emailInputRef}
                  id="buyer-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={buyerEmail}
                  onChange={(e) => setTypedEmail(e.target.value)}
                  aria-invalid={emailError ? true : undefined}
                  aria-describedby={emailError ? "buyer-email-hint buyer-email-error" : "buyer-email-hint"}
                  // 16px text so iOS doesn't zoom on focus, and a 48px target. Border, fill and the
                  // invalid state come from the base field styles (globals.css).
                  className="min-h-12 px-3 py-2 text-base"
                />
                <p id="buyer-email-hint" className="text-xs text-muted">
                  We&rsquo;ll send your tickets here. Booking with your Sheltüh account email
                  also lets you add yourself to Who&rsquo;s Going.
                </p>
                {emailError && (
                  <p id="buyer-email-error" role="alert" className="text-sm text-danger">
                    {emailError}
                  </p>
                )}
              </div>
            )}
            {orderTotal.totalCents > 0 && accountEmail && (
              <p className="mt-4 text-xs text-muted">
                Booking as {accountEmail}, your account email, so you can add yourself to Who&rsquo;s Going.
              </p>
            )}
            {/* Black, not orange: checkout stays quiet (brand-direction-one.md §6.9). */}
            <button
              type="button"
              onClick={handleCheckout}
              disabled={!hasAnyTickets || loading}
              className="btn btn-solid btn-lg mt-4 w-full"
            >
              {loading
                ? orderTotal.totalCents === 0
                  ? "Booking…"
                  : "Redirecting to checkout…"
                : orderTotal.totalCents === 0
                  ? "Get free tickets"
                  : "Checkout"}
            </button>
            {error && (
              <div className="mt-3">
                <Notice tone="danger" role="alert">
                  {error}
                </Notice>
              </div>
            )}
            <p className="mt-2 text-xs text-muted">
              {orderTotal.totalCents === 0
                ? "No payment step. We'll email you a link to confirm your tickets before they're issued. Signed in and booking with your account's verified email? That step is usually skipped."
                : "You'll pay securely on Stripe's own checkout page."}
            </p>
          </>
        ) : (
          <>
            <button type="button" disabled aria-disabled="true" className="btn btn-lg mt-4 w-full">
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

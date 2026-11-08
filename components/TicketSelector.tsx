"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import BuyerNameField from "@/components/checkout/BuyerNameField";
import SupportSheltuh, { SupportSummaryLine } from "@/components/checkout/SupportSheltuh";
import WaitlistBlock from "@/components/waitlist/WaitlistBlock";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { rememberCheckoutStarted, track } from "@/lib/analytics";
import { createCheckoutSession } from "@/lib/api/orders";
import { MAX_FREE_TICKETS_PER_ORDER } from "@/lib/api/types";
import { buyerNameError } from "@/lib/buyer-details";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { calculateOrderSummary, describeBookingFeeNote, sumOrderSummaries } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { formatTicketHeadline, isSoldOut, pricedTicketTypes } from "@/lib/pricing";
import { admitsOf, groupSavingLabel, groupTicketsLabel, isGroupTicket, peopleFor } from "@/lib/ticket-groups";
import { freeTicketsIn, isLow, opensWhenText, ownLimit, ownLimitHint, type Quantities } from "@/lib/ticket-limits";
import {
  isEmptyOther,
  NO_SUPPORT,
  supportAddedHint,
  supportCentsOf,
  supportErrorOf,
  totalIncludesWords,
  type SupportChoice,
} from "@/lib/support-choice";
import { isSupportSheltuhEnabled } from "@/lib/support";
import { getTrackingRef } from "@/lib/tracking-ref";
import type { SheltuhEvent, TicketType } from "@/lib/types";
import { stepperButtonClass } from "@/components/ui/stepper";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What a quantity of `ticket` is called to a screen reader: "3", or for a group ticket "2 groups, 8 tickets". */
function quantityWords(ticket: TicketType, quantity: number): string {
  if (!isGroupTicket(ticket)) return String(quantity);
  return `${quantity} ${quantity === 1 ? "group" : "groups"}, ${groupTicketsLabel(peopleFor(ticket, quantity))}`;
}

function orderTotalCents(ticketTypes: TicketType[], quantities: Quantities): number {
  return sumOrderSummaries(
    ticketTypes.map((t) => calculateOrderSummary(t.priceCents, quantities[t.id] ?? 0, t.feePolicy)),
  ).totalCents;
}

/**
 * The general admission ticket selector. Never sells a seated tier (reserved
 * seating): those are only bought by choosing seats on the seat page, so
 * they're left out here even if an event with a seat map reaches it.
 */
export default function TicketSelector({ event }: { event: SheltuhEvent }) {
  const ticketTypes = useMemo(() => event.ticketTypes.filter((ticket) => !ticket.seated), [event.ticketTypes]);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The panel's one live region: each change to the selection, and why a
  // stepper at its limit didn't change it (brand-direction-one.md §6.9).
  const [announcement, setAnnouncement] = useState("");
  const idPrefix = useId();
  // Signed in: the account's email is the default, since a ticket booked
  // with it is also what lets them add themselves to Who's Going. Whatever
  // they type replaces it. (Read optionally: this also renders without auth.)
  const auth = useOptionalAuth();
  const accountEmail = auth?.status === "signed-in" ? auth.email : undefined;
  const [typedEmail, setTypedEmail] = useState<string | null>(null);
  const buyerEmail = typedEmail ?? accountEmail ?? "";
  const [emailError, setEmailError] = useState<string | null>(null);
  // The name shared with the organiser (lib/buyer-details.ts): every checkout, paid or free. Not prefilled.
  const [buyerName, setBuyerName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  // Bumped with every email error (even the same words again), so focus can
  // follow each one to the field once it's rendered.
  const [emailErrorCount, setEmailErrorCount] = useState(0);
  // A free order waiting on its emailed confirmation link: the address it went to.
  const [sentTo, setSentTo] = useState<string | null>(null);
  const sentHeadingRef = useRef<HTMLHeadingElement>(null);
  const emailInputRef = useRef<HTMLInputElement>(null);
  // Set by "Use a different email": once the email field is back, focus it.
  const focusEmailField = useRef(false);
  // Support Sheltüh (components/checkout/SupportSheltuh.tsx): nothing until the buyer picks an amount.
  const [support, setSupport] = useState<SupportChoice>(NO_SUPPORT);
  // Checkout was pressed with an Other amount that can't be sent: its error shows at once.
  const [revealSupportError, setRevealSupportError] = useState(false);
  // The API's refusal of the amount (400 fieldErrors.supportCents), shown by the chips.
  const [supportServerError, setSupportServerError] = useState<string | null>(null);
  const supportInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (sentTo) {
      sentHeadingRef.current?.focus();
    } else if (focusEmailField.current) {
      focusEmailField.current = false;
      emailInputRef.current?.focus();
    }
  }, [sentTo]);

  // Back from the payment page (the browser's Back, restoring this page from the back/forward cache):
  // the checkout this button started is over here, so it's no longer "Opening checkout…".
  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) setLoading(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  // An email error (ours or the API's) puts focus on the field it's about,
  // after the message is in the field's description.
  useEffect(() => {
    if (emailErrorCount > 0) emailInputRef.current?.focus();
  }, [emailErrorCount]);

  function showEmailError(message: string) {
    setEmailError(message);
    setEmailErrorCount((n) => n + 1);
  }

  // Only live events (which carry an organiserId) can be checked out —
  // demo sample events never have one, since there's no backend to check
  // out against.
  const canCheckout = isApiConfigured && Boolean(event.organiserId);

  // Every tier sold out (the server's `soldOut`): no order summary or
  // checkout, the waitlist instead (brand-direction-one.md §6.11). While the
  // event hasn't ended; after that the waitlist is closed.
  const soldOut = isSoldOut(event);
  const ended = Date.parse(event.endsAt ?? event.startsAt) <= new Date().getTime();

  // Free tickets: at most MAX_FREE_TICKETS_PER_ORDER in total per booking,
  // across every free type, whether or not paid tickets are in it too (the
  // checkout API refuses anything more with a 400). Sold-out types, and ones not open yet, don't count.
  const freeTypeCount = ticketTypes.filter((t) => t.priceCents === 0 && !t.soldOut && !t.opensAfter).length;
  const freeLimitReached = freeTicketsIn(ticketTypes, quantities) >= MAX_FREE_TICKETS_PER_ORDER;
  const freeLimitText = `Up to ${MAX_FREE_TICKETS_PER_ORDER} free tickets per booking.`;

  /** How many of `ticket` this selection can hold, and why no more. */
  function limitFor(ticket: TicketType, selection: Quantities): { cap: number; reason: string } {
    const own = ownLimit(ticket);
    if (ticket.priceCents > 0) return { cap: own, reason: ownLimitHint(ticket) };
    const freeRoom =
      MAX_FREE_TICKETS_PER_ORDER - (freeTicketsIn(ticketTypes, selection) - (selection[ticket.id] ?? 0));
    return freeRoom < own ? { cap: freeRoom, reason: freeLimitText } : { cap: own, reason: ownLimitHint(ticket) };
  }

  function announce(text: string) {
    // The same words again (another press at a limit) must still be read out:
    // a trailing no-break space changes the region's text.
    setAnnouncement((prev) => (prev === text ? `${text}\u00a0` : text));
  }

  function setQuantity(ticket: TicketType, value: number) {
    const current = quantities[ticket.id] ?? 0;
    const { cap, reason } = limitFor(ticket, quantities);
    const clamped = Math.max(0, Math.min(value, cap));
    // A press on a stepper that's at its limit (aria-disabled, so still
    // clickable) changes nothing, and keeps any message on screen. At the
    // top, it says why.
    if (clamped === current) {
      if (value > current) announce(`${ticket.name}: ${quantityWords(ticket, current)}. ${reason}`);
      return;
    }
    const next = { ...quantities, [ticket.id]: clamped };
    setQuantities(next);
    // A refusal was about the old selection.
    setError(null);
    // Support Sheltüh is for paid orders only: with no paid ticket left, it goes (and isn't
    // pre-selected when one comes back).
    const nextHasPaid = ticketTypes.some((t) => t.priceCents > 0 && (next[t.id] ?? 0) > 0);
    const nextSupportCents = nextHasPaid ? supportCentsOf(support) : 0;
    if (!nextHasPaid) clearSupport();
    const totalCents = orderTotalCents(ticketTypes, next) + nextSupportCents;
    const reachedLimit = clamped > current && clamped >= limitFor(ticket, next).cap;
    announce(
      `${ticket.name}: ${quantityWords(ticket, clamped)}. Total ${formatAud(totalCents)}${totalCents > 0 ? ` incl. ${totalIncludesWords(nextSupportCents)}` : ""}.` +
        (reachedLimit ? ` ${limitFor(ticket, next).reason}` : ""),
    );
  }

  function clearSupport() {
    setSupport(NO_SUPPORT);
    setRevealSupportError(false);
    setSupportServerError(null);
  }

  function changeSupport(next: SupportChoice) {
    setSupport(next);
    setRevealSupportError(false);
    setSupportServerError(null);
    // A refusal may have been about the amount.
    setError(null);
    // Each pick says the new total; typing an Other amount doesn't (its field has the value).
    if (next.option === "other" && support.option === "other") return;
    const cents = supportCentsOf(next);
    const total = ticketsTotal.totalCents + cents;
    const what =
      next.option === "none"
        ? "Support Sheltüh removed."
        : next.option === "other"
          ? "Other amount for Support Sheltüh: enter an amount."
          : `Support Sheltüh: ${formatAud(cents)} added.`;
    announce(`${what} Total ${formatAud(total)} incl. ${totalIncludesWords(cents)}.${supportAddedHint(next)}`);
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

  const ticketsTotal = sumOrderSummaries(lineSummaries.map((line) => line.summary));

  const hasAnyTickets = lineSummaries.some((line) => line.quantity > 0);
  // Tickets as people get them: a group of 4 is 4 tickets (the order summary says so once a group is chosen).
  const ticketCount = lineSummaries.reduce((n, line) => n + peopleFor(line.ticket, line.quantity), 0);
  const hasGroupSelected = lineSummaries.some((line) => line.quantity > 0 && isGroupTicket(line.ticket));
  // Support Sheltüh: offered (and sent) only with a paid ticket in the order, and only while it's
  // switched on (isSupportSheltuhEnabled; paused by default); it's in the total the buyer sees
  // (all-inclusive), but never in the tickets' subtotal or booking fees.
  const hasPaidTickets = ticketsTotal.subtotalCents > 0;
  const offerSupport = hasPaidTickets && isSupportSheltuhEnabled();
  const supportCents = offerSupport ? supportCentsOf(support) : 0;
  const orderTotal = { ...ticketsTotal, totalCents: ticketsTotal.totalCents + supportCents };
  // Every ticket on sale free: no payment step, but an emailed confirmation link.
  const allFree = pricedTicketTypes({ ...event, ticketTypes }).every((t) => t.priceCents === 0);
  const buyerPaysAFee = ticketTypes.some((t) => t.priceCents > 0 && t.feePolicy === "buyer-pays");
  // Paid orders give Stripe an email at checkout; free ones skip Stripe, so
  // this is the only way their tickets can reach the buyer.
  const needsEmail = canCheckout && hasAnyTickets && orderTotal.totalCents === 0;
  // Before anything is chosen there's no total to go by: the event's own
  // tickets decide whether this is a free booking.
  const freeBooking = hasAnyTickets ? orderTotal.totalCents === 0 : allFree;

  async function handleCheckout() {
    if (!event.organiserId) return;
    setError(null);
    setEmailError(null);
    setNameError(null);
    setSupportServerError(null);
    const nameProblem = buyerNameError(buyerName);
    if (nameProblem) {
      setNameError(nameProblem);
      nameInputRef.current?.focus();
      return;
    }
    if (needsEmail && !EMAIL_REGEX.test(buyerEmail.trim())) {
      showEmailError("Enter the email address to send your tickets to.");
      return;
    }
    // An Other amount that can't be sent: say why, by its field, rather than checking out without it.
    if (offerSupport && supportErrorOf(support)) {
      setRevealSupportError(true);
      supportInputRef.current?.focus();
      return;
    }
    // Other chosen but left empty is no support: shown as nothing chosen, and nothing sent.
    if (isEmptyOther(support)) setSupport(NO_SUPPORT);
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
        // Paid orders only, and only when there is some (lib/api/orders.ts leaves 0 out). Part
        // of the checkout attempt's basket, so a changed amount gets a new idempotency key.
        supportCents > 0 ? supportCents : undefined,
        buyerName.trim(),
      );
      track("checkout_started", {
        event_slug: event.slug,
        ticket_count: lineItems.reduce((total, line) => total + line.quantity, 0),
        has_support: supportCents > 0,
        free: freeBooking,
      });
      if ("url" in result) {
        rememberCheckoutStarted(result);
        window.location.href = result.url;
        // Deliberately no setLoading(false) here — the page is navigating
        // away, and re-enabling the button would just invite a double-click.
        // Coming Back to this page resets it (the pageshow listener above).
        return;
      }
      setSentTo(email ?? "");
      setLoading(false);
    } catch (err) {
      if (err instanceof ApiError && err.fieldErrors) {
        // The email has its own field; anything else (such as too many free
        // tickets in `lineItems`) has no field to highlight, so it's said in
        // full rather than as "fix the highlighted fields".
        // Support Sheltüh's is said by its chips (with the rest while they aren't offered, so it's never lost).
        const { buyerName: nameMessage, buyerEmail: emailMessage, supportCents: supportMessage, ...others } = err.fieldErrors;
        const supportByChips = Boolean(supportMessage) && offerSupport;
        if (nameMessage) {
          setNameError(nameMessage);
          nameInputRef.current?.focus();
        }
        if (emailMessage) showEmailError(emailMessage);
        if (supportByChips && supportMessage) setSupportServerError(supportMessage);
        const otherMessages = [...Object.values(others), supportByChips ? undefined : supportMessage].filter(Boolean).join(" ");
        if (otherMessages || (!nameMessage && !emailMessage && !supportByChips)) setError(otherMessages || err.message);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't start checkout. Try again.");
      }
      setLoading(false);
    }
  }

  // Support Sheltüh, right above Checkout: paid orders only, while it's offered.
  const supportBlock = offerSupport ? (
    <div className="mt-4 border-t border-surface-border pt-4">
      <SupportSheltuh
        choice={support}
        onChange={changeSupport}
        revealError={revealSupportError}
        serverError={supportServerError}
        otherInputRef={supportInputRef}
      />
    </div>
  ) : null;

  // The booking fee, explained once, small, by the Checkout button; only where a buyer pays it (not for
  // free-only events, or ones whose organiser absorbs every fee).
  const feeNote = buyerPaysAFee ? <p className="mt-2 text-xs text-muted">{describeBookingFeeNote()}</p> : null;

  return (
    <div className="flex flex-col gap-5 rounded-card border border-foreground bg-card p-4 sm:p-5">
      {/* Before the tickets, so the limit is known before choosing. Not a live
          region: the panel's status below says when a limit is reached. */}
      {freeTypeCount > 0 && !soldOut && (
        <p id="free-ticket-limit" className={freeLimitReached ? "text-xs text-muted" : "sr-only"}>
          {freeLimitReached
            ? `Up to ${MAX_FREE_TICKETS_PER_ORDER} free tickets per booking.`
            : freeLimitText}
        </p>
      )}

      <ul className="flex flex-col">
        {lineSummaries.map(({ ticket, quantity }, index) => {
          const { cap } = limitFor(ticket, quantities);
          // The type's own limit, said before it's reached. A free type within
          // the free-ticket limit has the line above instead.
          const showOwnLimit =
            ticket.priceCents > 0 || ownLimit(ticket) < MAX_FREE_TICKETS_PER_ORDER || isLow(ticket);
          const ownLimitId = `${idPrefix}-limit-${index}`;
          const group = isGroupTicket(ticket);
          const groupLineId = `${idPrefix}-group-${index}`;
          // "save A$20": only when the group is really cheaper than the same number of singles.
          const saving = group ? groupSavingLabel(ticket, ticketTypes) : null;
          const describedBy =
            [showOwnLimit ? ownLimitId : null, group ? groupLineId : null, ticket.priceCents === 0 ? "free-ticket-limit" : null]
              .filter(Boolean)
              .join(" ") || undefined;
          const tierSoldOut = ticket.soldOut === true;
          // Waiting for the tier above to sell out: shown, muted, with words in place of the stepper.
          // A tier that sold out before it was set to wait says "Sold out", not "Opens when…".
          const waitingText = tierSoldOut ? null : opensWhenText(ticket);
          const dimmed = tierSoldOut || waitingText !== null;
          return (
            <li
              key={ticket.id}
              className="flex flex-col gap-3 border-t border-surface-border py-4 first:border-t-0 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0 flex-1">
                <p className={`text-base leading-snug font-semibold ${waitingText ? "text-muted" : "text-foreground"}`}>
                  {ticket.name}
                </p>
                {/* The all-inclusive price per ticket comes first and is the loudest
                    number, at every width (ACCC: brand-direction-one.md §6.8). A sold-out
                    or not-yet-open tier keeps its total (it's still advertised), muted. */}
                <p
                  className={`mt-1 text-xl leading-7 font-bold tabular-nums ${dimmed ? "text-muted" : "text-foreground"}`}
                >
                  {formatTicketHeadline(ticket)}
                </p>
                {group && (
                  // What one group gets, and what it saves: words, not colour.
                  <p id={groupLineId} className="mt-1 text-sm text-foreground">
                    {groupTicketsLabel(admitsOf(ticket))}
                    {saving && (
                      <>
                        {" · "}
                        <span className="font-semibold">{saving}</span>
                      </>
                    )}
                  </p>
                )}
                {ticket.description && <p className="mt-1 text-sm text-muted">{ticket.description}</p>}
                {showOwnLimit && !tierSoldOut && !waitingText && (
                  // "Only N left" is the server's own count (10 or fewer), in black, never orange. The plain per-booking
                  // limit is for screen readers only: the stepper's + is disabled at it.
                  <p
                    id={ownLimitId}
                    className={isLow(ticket) ? "mt-1 text-xs font-semibold text-foreground" : "sr-only"}
                  >
                    {ownLimitHint(ticket)}
                  </p>
                )}
              </div>
              {waitingText ? (
                // Words in place of the stepper: never a colour alone. Nothing here can be chosen.
                <p className="shrink-0 text-sm font-semibold text-foreground sm:max-w-48 sm:text-right">{waitingText}</p>
              ) : tierSoldOut ? (
                // Words in place of the stepper: never a colour alone.
                <p className="eyebrow shrink-0 text-foreground">Sold out</p>
              ) : (
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
                  <span className="w-10 text-center text-lg leading-6 font-semibold tabular-nums text-foreground">
                    {quantity}
                    {group && <span className="sr-only">{quantity === 1 ? " group" : " groups"}</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => setQuantity(ticket, quantity + 1)}
                    aria-disabled={quantity >= cap}
                    aria-label={`Increase quantity for ${ticket.name}`}
                    aria-describedby={describedBy}
                    className={stepperButtonClass}
                  >
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Each change to the selection, with the new total (and, at a limit, why). */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {soldOut ? (
        <WaitlistBlock eventId={event.id} closed={ended} demo={!canCheckout} />
      ) : (
        <div className="border-t border-foreground pt-4">
          <h3 className="eyebrow text-muted">Order summary</h3>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">{hasGroupSelected ? `Tickets (${ticketCount})` : "Tickets"}</dt>
              <dd className="tabular-nums text-foreground">{formatAud(orderTotal.subtotalCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Booking fees</dt>
              <dd className="tabular-nums text-foreground">{formatAud(orderTotal.buyerFeeCents)}</dd>
            </div>
            <SupportSummaryLine cents={supportCents} />
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
                Link sent to <span className="break-all font-semibold">{sentTo}</span>. Press Confirm in the email
                within 24 hours.
              </p>
              <p className="text-xs text-muted">
                Not there? Check spam. Tickets aren&rsquo;t held until you confirm.
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
              <div className="mt-4">
                <BuyerNameField
                  id="buyer-name"
                  value={buyerName}
                  onChange={(value) => {
                    setBuyerName(value);
                    setNameError(null);
                  }}
                  error={nameError}
                  inputRef={nameInputRef}
                />
              </div>
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
                    name="email"
                    inputMode="email"
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
                    Tickets are sent here. Use your account email to join Who&rsquo;s Going.
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
                  Booking as {accountEmail}.
                </p>
              )}
              {/* Right above Checkout, for paid orders only (the owner's placement). */}
              {supportBlock}
              {/* Black, not orange: checkout stays quiet (brand-direction-one.md §6.9).
                  Busy, not disabled, while it works: focus stays on it. */}
              <Button
                variant="solid"
                size="lg"
                onClick={handleCheckout}
                busy={loading}
                disabled={!hasAnyTickets}
                aria-describedby={hasAnyTickets ? undefined : "checkout-hint"}
                className="mt-4 w-full"
              >
                {loading
                  ? freeBooking
                    ? "Booking…"
                    : "Opening checkout…"
                  : freeBooking
                    ? "Free tickets"
                    : "Checkout"}
              </Button>
              {error && (
                <div className="mt-3">
                  <Notice tone="danger" role="alert">
                    {error}
                  </Notice>
                </div>
              )}
              {feeNote}
              <p className="mt-2 text-xs text-muted">
                By booking you agree to the{" "}
                <Link href="/purchase-terms" className="text-foreground underline underline-offset-2">
                  Purchase Terms
                </Link>
                . See our{" "}
                <Link href="/privacy" className="text-foreground underline underline-offset-2">
                  Privacy Policy
                </Link>
                .
              </p>
              {!hasAnyTickets ? (
                <p id="checkout-hint" className="sr-only">
                  Choose tickets to continue.
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  {freeBooking
                    ? "We’ll email a link to confirm your tickets."
                    : "You’ll pay on the next page, via Stripe."}
                </p>
              )}
            </>
          ) : (
            <>
              {/* The demo previews it too (its total is a preview only). */}
              {supportBlock}
              <button type="button" disabled aria-disabled="true" className="btn btn-lg mt-4 w-full">
                Checkout unavailable in this demo
              </button>
              {feeNote}
              <p className="mt-2 text-xs text-muted">
                Demo only. Nothing is charged or issued.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

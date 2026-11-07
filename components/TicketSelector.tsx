"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { useSetBuyBar } from "@/components/checkout/BuyBar";
import { InfoIcon, LockIcon } from "@/components/checkout/icons";
import BuyerNameField from "@/components/checkout/BuyerNameField";
import SupportSheltuh, { SupportSummaryLine } from "@/components/checkout/SupportSheltuh";
import WaitlistBlock from "@/components/waitlist/WaitlistBlock";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { createCheckoutSession } from "@/lib/api/orders";
import { MAX_FREE_TICKETS_PER_ORDER } from "@/lib/api/types";
import { buyerNameError } from "@/lib/buyer-details";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import { calculateOrderSummary, describeBookingFee, describeBookingFeeNote, sumOrderSummaries } from "@/lib/fees";
import { formatAud, formatAudExact } from "@/lib/format";
import { formatTicketHeadline, getTicketBuyerTotalCents, isSoldOut, pricedTicketTypes } from "@/lib/pricing";
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

const NAME_FIELD_ID = "buyer-name";
/** The quantity stepper's − and +: the mockup's 56×48 squarish buttons. aria-disabled (not disabled) keeps focus on them at 0 and at the cap. */
const quantityButtonClass =
  "flex h-12 w-14 shrink-0 items-center justify-center rounded-card border border-foreground bg-card text-xl font-semibold text-foreground transition-colors hover:bg-surface aria-disabled:cursor-not-allowed aria-disabled:border-surface-border aria-disabled:text-muted aria-disabled:hover:bg-card";
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
  // The release the quantity stepper is for (the last one tapped); until one is, the first on sale.
  // Every release keeps its own quantity: tapping another card moves the stepper to it.
  const [activeId, setActiveId] = useState<string | null>(null);
  // The Booking fees (i): its short explanation, shown under the row once asked for.
  const [feeOpen, setFeeOpen] = useState(false);
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
  // The event page's phone buy bar (null where there's none): once it exists, it is the phone's one Checkout.
  const setBuyBar = useSetBuyBar();
  // True from the press until the checkout has an answer: a second tap (the bar's or the panel's) in the
  // same moment, before the busy state has rendered, must not start another order.
  const submitting = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

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
      if (event.persisted) {
        submitting.current = false;
        setLoading(false);
      }
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

  /** Tapping an available release's card: the stepper moves to it, and a release with none chosen gets its first ticket. */
  function selectTicket(ticket: TicketType) {
    setActiveId(ticket.id);
    const current = quantities[ticket.id] ?? 0;
    if (current === 0) setQuantity(ticket, 1);
    else announce(`${ticket.name}: ${quantityWords(ticket, current)}.`);
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

  // Which release the stepper shows: the one tapped, else the first that can be bought (not sold out, not waiting).
  const buyable = ticketTypes.filter((t) => t.soldOut !== true && !t.opensAfter);
  const activeTicket = buyable.find((t) => t.id === activeId) ?? buyable[0];

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
    if (!event.organiserId || submitting.current) return;
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
    submitting.current = true;
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
      if ("url" in result) {
        window.location.href = result.url;
        // Deliberately no setLoading(false) here — the page is navigating
        // away, and re-enabling the button would just invite a double-click.
        // Coming Back to this page resets it (the pageshow listener above).
        return;
      }
      setSentTo(email ?? "");
      submitting.current = false;
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
      submitting.current = false;
      setLoading(false);
    }
  }

  // The one submit, for the panel's Checkout and the phone buy bar alike (the bar calls it through this ref).
  const handleCheckoutRef = useRef(handleCheckout);
  useEffect(() => {
    handleCheckoutRef.current = handleCheckout;
  });
  const pressBuyBar = useCallback(() => {
    void handleCheckoutRef.current();
  }, []);

  // The phone buy bar mirrors this panel: its total is the Order summary's own figure, and its
  // button is Checkout. Until something is chosen (or while it can't be bought) it registers
  // nothing and stays the page's link to the tickets.
  const barTotalCents = orderTotal.totalCents;
  const barLabel = freeBooking ? "Free tickets" : "Buy tickets";
  const barBusyLabel = freeBooking ? "Booking…" : "Opening…";
  const barNote = barTotalCents === 0 ? "No booking fee" : supportCents > 0 ? "incl. booking fee + Support Sheltüh" : "incl. booking fee";
  const barAmount = formatAudExact(barTotalCents);
  const barActive = canCheckout && !soldOut;
  useEffect(() => {
    if (!setBuyBar) return;
    if (!barActive) {
      setBuyBar(null);
    } else if (sentTo !== null) {
      setBuyBar({ kind: "status", amount: "Check your inbox", note: "Press Confirm in the email", label: "View" });
    } else if (!hasAnyTickets) {
      setBuyBar(null);
    } else {
      setBuyBar({
        kind: "checkout",
        amount: barAmount,
        note: barNote,
        label: barLabel,
        busy: loading,
        busyLabel: barBusyLabel,
        onPress: pressBuyBar,
      });
    }
  }, [setBuyBar, barActive, sentTo, hasAnyTickets, barAmount, barNote, barLabel, barBusyLabel, loading, pressBuyBar]);
  useEffect(() => () => setBuyBar?.(null), [setBuyBar]);

  // A refusal (or a field's error) is said where the buyer is looking: on a phone Checkout is the bar's, so the
  // panel can be out of sight. Only if it's not already in view; the page's scroll-padding clears the bar.
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [error]);
  useEffect(() => {
    if (nameError) document.getElementById(`${NAME_FIELD_ID}-error`)?.scrollIntoView?.({ block: "nearest" });
  }, [nameError]);

  // Support Sheltüh, right above Checkout: paid orders only, while it's offered.
  const supportBlock = offerSupport ? (
    <div className="mt-5 border-t border-surface-border pt-5">
      <SupportSheltuh
        choice={support}
        onChange={changeSupport}
        revealError={revealSupportError}
        serverError={supportServerError}
        otherInputRef={supportInputRef}
      />
    </div>
  ) : null;

  // The booking fee, explained once, small, under Checkout (with the owner's (i) mark); only where a buyer
  // pays it (not for free-only events, or ones whose organiser absorbs every fee).
  const feeNote = buyerPaysAFee ? (
    <p className="mt-3 flex items-start gap-2 text-sm text-muted">
      <InfoIcon className="mt-0.5 size-4 shrink-0" />
      <span>{describeBookingFeeNote()}</span>
    </p>
  ) : null;

  // One tier selected, as singles: "(2 × A$24.00)" says what the Tickets line is made of.
  const selectedLines = lineSummaries.filter((line) => line.quantity > 0);
  const onlyLine = selectedLines.length === 1 ? selectedLines[0] : undefined;
  const ticketsFormula =
    onlyLine && !isGroupTicket(onlyLine.ticket) && onlyLine.ticket.priceCents > 0
      ? `(${onlyLine.quantity} × ${formatAudExact(onlyLine.ticket.priceCents)})`
      : null;
  // With several releases on sale, the stepper says whose it is.
  const showStepperTarget = buyable.length > 1;
  const feeInfoId = `${idPrefix}-fee-info`;
  const feeText = `Booking fee: ${describeBookingFee()}.`;

  return (
    <div className="flex flex-col gap-4">
      {/* Before the tickets, so the limit is known before choosing. Not a live
          region: the panel's status below says when a limit is reached. */}
      {freeTypeCount > 0 && !soldOut && (
        <p id="free-ticket-limit" className={freeLimitReached ? "text-xs text-muted" : "sr-only"}>
          {freeLimitReached
            ? `Up to ${MAX_FREE_TICKETS_PER_ORDER} free tickets per booking.`
            : freeLimitText}
        </p>
      )}

      {/* One compact card per release. Sold out (or not open yet): sunken and muted, with words, nothing to press.
          On sale: a button that selects it; chosen (some of it in the order): peach with an orange border (and the
          quantity says so too: never colour alone). The quantity stepper is below the cards, for the selected one. */}
      <ul className="flex flex-col gap-2">
        {lineSummaries.map(({ ticket, quantity }, index) => {
          const showOwnLimit =
            ticket.priceCents > 0 || ownLimit(ticket) < MAX_FREE_TICKETS_PER_ORDER || isLow(ticket);
          const ownLimitId = `${idPrefix}-limit-${index}`;
          const group = isGroupTicket(ticket);
          const groupLineId = `${idPrefix}-group-${index}`;
          // "save A$20": only when the group is really cheaper than the same number of singles.
          const saving = group ? groupSavingLabel(ticket, ticketTypes) : null;
          const tierSoldOut = ticket.soldOut === true;
          // Waiting for the tier above to sell out: shown, muted, with words instead of a status pill.
          // A tier that sold out before it was set to wait says "Sold out", not "Opens when…".
          const waitingText = tierSoldOut ? null : opensWhenText(ticket);
          const dimmed = tierSoldOut || waitingText !== null;
          const chosen = quantity > 0;
          const active = activeTicket?.id === ticket.id;
          const cardClass = dimmed
            ? "border-surface-border bg-surface"
            : chosen
              ? "border-signal bg-tint ring-1 ring-signal"
              : "border-surface-border bg-card";
          // The all-inclusive price per ticket is the loudest number on the card, at every width (ACCC:
          // brand-direction-one.md §6.8): the amount bold, the rest ("incl. booking fee") lighter. A sold-out
          // or not-yet-open tier keeps its total (it's still advertised), muted.
          const headline = formatTicketHeadline(ticket);
          const amount = ticket.priceCents === 0 ? headline : formatAud(getTicketBuyerTotalCents(ticket));
          const rest = headline.slice(amount.length);
          const title = (
            <span className="flex min-w-0 flex-col">
              <span
                className={`text-sm leading-5 font-bold tracking-wide break-words uppercase ${dimmed ? "text-muted" : "text-foreground"}`}
              >
                {ticket.name}
              </span>
              <span
                data-ticket-price=""
                className={`flex flex-wrap items-baseline gap-x-1 text-base leading-6 tabular-nums sm:text-xl sm:leading-7 ${dimmed ? "text-muted" : "text-foreground"}`}
              >
                {/* Never broken mid-phrase: where it's tight, "incl. booking fee" drops under the amount whole. */}
                <span className="font-bold whitespace-nowrap">{amount}</span>
                {rest && <span className="font-medium whitespace-nowrap">{rest}</span>}
              </span>
            </span>
          );
          const pill = tierSoldOut ? (
            // Words, not colour alone.
            <span className="shrink-0 rounded-full bg-surface-border px-3 py-1 text-xs leading-4 font-semibold tracking-wide text-foreground uppercase">
              Sold out
            </span>
          ) : waitingText ? null : (
            <span className="shrink-0 rounded-full bg-signal/15 px-3 py-1 text-xs leading-4 font-semibold tracking-wide text-signal-ink uppercase">
              Available
            </span>
          );
          return (
            <li key={ticket.id} data-ticket-card="" className={`rounded-card border ${cardClass}`}>
              {dimmed ? (
                <div className="flex items-center justify-between gap-3 px-4 py-3">
                  {title}
                  {pill}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => selectTicket(ticket)}
                  aria-pressed={active}
                  className="flex w-full items-center justify-between gap-3 rounded-card px-4 py-3 text-left"
                >
                  {title}
                  {pill}
                </button>
              )}
              {/* Only for the plain per-booking limit: heard, not seen (the stepper's + is aria-disabled at it). */}
              {showOwnLimit && !dimmed && !isLow(ticket) && (
                <p id={ownLimitId} className="sr-only">
                  {ownLimitHint(ticket)}
                </p>
              )}
              {(group || ticket.description || waitingText || (isLow(ticket) && !dimmed) || (chosen && !active)) && (
                <div className="-mt-1 flex flex-col gap-1 px-4 pb-3">
                  {group && (
                    // What one group gets, and what it saves: words, not colour.
                    <p id={groupLineId} className="text-sm text-foreground">
                      {groupTicketsLabel(admitsOf(ticket))}
                      {saving && (
                        <>
                          {" · "}
                          <span className="font-semibold">{saving}</span>
                        </>
                      )}
                    </p>
                  )}
                  {ticket.description && <p className="text-sm text-muted">{ticket.description}</p>}
                  {waitingText && (
                    // Words in place of the pill: never a colour alone. Nothing here can be chosen.
                    <p className="text-sm font-semibold text-foreground">{waitingText}</p>
                  )}
                  {showOwnLimit && !dimmed && isLow(ticket) && (
                    // "Only N left" is the server's own count (10 or fewer), in black, never orange.
                    <p id={ownLimitId} className="text-xs font-semibold text-foreground">
                      {ownLimitHint(ticket)}
                    </p>
                  )}
                  {/* Another release than the stepper's: its count stays visible (tap the card to change it). */}
                  {chosen && !active && (
                    <p className="text-sm font-semibold text-foreground">
                      {quantityWords(ticket, quantity)} selected
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* Quantity, below the cards, for the selected release. */}
      {activeTicket && !soldOut && (
        <div>
          <p className="text-lg leading-6 font-bold">
            Quantity
            {showStepperTarget && <span className="font-normal text-muted"> · {activeTicket.name}</span>}
          </p>
          {(() => {
            const ticket = activeTicket;
            const quantity = quantities[ticket.id] ?? 0;
            const { cap } = limitFor(ticket, quantities);
            const index = ticketTypes.indexOf(ticket);
            const showOwnLimit =
              ticket.priceCents > 0 || ownLimit(ticket) < MAX_FREE_TICKETS_PER_ORDER || isLow(ticket);
            const group = isGroupTicket(ticket);
            const describedBy =
              [showOwnLimit ? `${idPrefix}-limit-${index}` : null, group ? `${idPrefix}-group-${index}` : null, ticket.priceCents === 0 ? "free-ticket-limit" : null]
                .filter(Boolean)
                .join(" ") || undefined;
            return (
              <div role="group" aria-label={`Quantity for ${ticket.name}`} className="mt-3 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity(ticket, quantity - 1)}
                  aria-disabled={quantity <= 0}
                  aria-label={`Decrease quantity for ${ticket.name}`}
                  className={quantityButtonClass}
                >
                  &minus;
                </button>
                <span className="min-w-10 text-center text-xl leading-6 font-bold tabular-nums text-foreground">
                  {quantity}
                  {group && <span className="sr-only">{quantity === 1 ? " group" : " groups"}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity(ticket, quantity + 1)}
                  aria-disabled={quantity >= cap}
                  aria-label={`Increase quantity for ${ticket.name}`}
                  aria-describedby={describedBy}
                  className={quantityButtonClass}
                >
                  +
                </button>
              </div>
            );
          })()}
        </div>
      )}

      {/* Each change to the selection, with the new total (and, at a limit, why). The phone buy bar's
          total is the same figure, and is not a live region of its own. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {soldOut ? (
        <WaitlistBlock eventId={event.id} closed={ended} demo={!canCheckout} />
      ) : (
        <div className="border-t border-surface-border pt-5">
          <h3 className="text-lg leading-6 font-bold">Order summary</h3>
          <dl className="mt-3 flex flex-col gap-2 text-base">
            <div className="flex justify-between gap-4">
              <dt className="text-foreground">
                {hasGroupSelected ? `Tickets (${ticketCount})` : "Tickets"}
                {ticketsFormula && (
                  <>
                    {" "}
                    <span className="tabular-nums">{ticketsFormula}</span>
                  </>
                )}
              </dt>
              <dd className="tabular-nums text-foreground">{formatAudExact(orderTotal.subtotalCents)}</dd>
            </div>
            <div className="flex flex-wrap justify-between gap-x-4">
              <dt className="flex items-center text-foreground">
                Booking fees
                {/* A toggletip: pressed, it says what the fee is, in a polite status under the row. A 44px
                    target that doesn't make the row taller. */}
                <button
                  type="button"
                  onClick={() => {
                    // Said by the panel's one live region too, the moment it opens.
                    if (!feeOpen) announce(feeText);
                    setFeeOpen(!feeOpen);
                  }}
                  aria-expanded={feeOpen}
                  aria-controls={feeOpen ? feeInfoId : undefined}
                  aria-label="About the booking fee"
                  className="-my-3 -ml-0.5 inline-flex size-11 shrink-0 items-center justify-center text-muted"
                >
                  <InfoIcon className="size-5" />
                </button>
              </dt>
              <dd className="tabular-nums text-foreground">{formatAudExact(orderTotal.buyerFeeCents)}</dd>
              {feeOpen && (
                <dd id={feeInfoId} className="basis-full text-sm text-muted">
                  {feeText}
                </dd>
              )}
            </div>
            <SupportSummaryLine cents={supportCents} />
            {/* The total is the largest number in the panel, in a peach box. */}
            <div className="mt-1 flex items-baseline justify-between gap-4 rounded-card bg-tint px-4 py-3">
              <dt className="text-lg leading-6 font-bold text-foreground">Total</dt>
              <dd className="text-2xl leading-8 font-bold tabular-nums text-foreground">
                {formatAudExact(orderTotal.totalCents)}
              </dd>
            </div>
          </dl>

          {canCheckout && sentTo !== null ? (
            <div className="mt-5 flex flex-col gap-2 border-t border-surface-border pt-5">
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
              <div className="mt-5 border-t border-surface-border pt-5">
                <h3 className="text-lg leading-6 font-bold">Your details</h3>
                <div className="mt-3">
                  <BuyerNameField
                    id={NAME_FIELD_ID}
                    value={buyerName}
                    onChange={(value) => {
                      setBuyerName(value);
                      setNameError(null);
                    }}
                    error={nameError}
                    inputRef={nameInputRef}
                    placeholderLabel
                  />
                </div>
                {needsEmail && (
                  <div className="mt-4 flex flex-col gap-1">
                    <label htmlFor="buyer-email" className="text-sm font-semibold">
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
                      // 16px text so iOS doesn't zoom on focus, and a 48px target; the same look as the name field.
                      className="min-h-12 rounded-card border-muted bg-card px-4 py-2 text-base aria-invalid:border-danger"
                    />
                    <p id="buyer-email-hint" className="text-sm text-muted">
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
                  <p className="mt-3 flex flex-wrap items-center gap-x-3 text-base text-muted">
                    <span className="break-all">
                      Booking as <span className="text-foreground underline underline-offset-4">{accountEmail}</span>
                    </span>
                    {/* The existing account flow: ends this browser's session only (as "wrong account" does
                        elsewhere); the selection stays, and the order goes the guest way, with Stripe asking for the email. */}
                    {auth?.status === "signed-in" && (
                      <button
                        type="button"
                        onClick={() => auth.signOut("local")}
                        className="inline-flex min-h-11 items-center text-xs text-muted underline underline-offset-4"
                      >
                        Not you? Sign out
                      </button>
                    )}
                  </p>
                )}
              </div>
              {/* Right above Checkout, for paid orders only (the owner's placement). */}
              {supportBlock}
              {/* The panel's Checkout, orange with a lock, at every width (owner: show it on phones too, as in the
                  mockup). On phones the sticky buy bar (components/checkout/BuyBar.tsx) presses this same
                  handler, so both start one checkout. Busy, not disabled, while it works: focus
                  stays on it. Disabled only with nothing chosen (the hint says what to do). White on orange is
                  3.4:1, so the label is 20px bold (large text). */}
              <Button
                variant="signal"
                size="lg"
                onClick={handleCheckout}
                busy={loading}
                disabled={!hasAnyTickets}
                aria-describedby={hasAnyTickets ? undefined : "checkout-hint"}
                className={`mt-5 h-14 w-full gap-3 rounded-card text-xl leading-6 font-bold tracking-normal normal-case ${loading || !hasAnyTickets ? "" : "text-paper"}`}
              >
                {!loading && <LockIcon className="size-6 shrink-0" />}
                {loading
                  ? freeBooking
                    ? "Booking…"
                    : "Opening checkout…"
                  : freeBooking
                    ? "Free tickets"
                    : "Checkout"}
              </Button>
              {feeNote}
              {error && (
                <div ref={errorRef} className="mt-3">
                  <Notice tone="danger" role="alert">
                    {error}
                  </Notice>
                </div>
              )}
              <p className="mt-3 text-xs text-muted">
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
              <button type="button" disabled aria-disabled="true" className="btn btn-lg mt-5 w-full rounded-card">
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

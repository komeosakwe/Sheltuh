"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { SupportSummaryLine } from "@/components/checkout/SupportSheltuh";
import TicketStub from "@/components/tickets/TicketStub";
import WalletButtons from "@/components/tickets/WalletButtons";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import Strap from "@/components/ui/Strap";
import { ApiError } from "@/lib/api/client";
import { getOrderBySession, getOrderPayment } from "@/lib/api/orders";
import {
  CHECKOUT_CLOSED_LABEL,
  checkoutClosedBody,
  checkoutEndedAction,
  checkoutSoldOutBody,
  checkoutSoldOutLabel,
  eventPathFor,
  formatHoldDeadline,
  type CheckoutOrderContext,
} from "@/lib/checkout-pay";
import { eventZone, formatAud, formatEventWhen } from "@/lib/format";
import { REFUND_ACL_STATEMENT, refundTermsLine } from "@/lib/refund-policy";
import { placeName } from "@/lib/place";
import { SUPPORT_REFUND_NOTE } from "@/lib/support";
import { compareSeats } from "@/lib/seating/format";
import { forgetPendingCheckout } from "@/lib/seating/pending-checkout";
import type { CustomerOrder, StateCode } from "@/lib/api/types";

export type LoadState =
  | { status: "loading" }
  | { status: "confirming" } // paid on Stripe's side, waiting on our webhook to land
  | { status: "ready"; order: CustomerOrder }
  | { status: "oversold"; order: CustomerOrder }
  | { status: "not-found" }
  | { status: "error"; message: string }
  // Back from Stripe without paying (a redirect-based method cancelled or failed): the checkout is still open.
  | {
      status: "payment-open";
      context: CheckoutOrderContext;
      expiresAt: string;
      /** The event's zone and state, for the seat hold's end ("8:31 pm Perth time"); absent: Melbourne. */
      eventTimeZone?: string;
      eventState?: StateCode;
    }
  // Stripe has the payment but it's taking a while to clear: the tickets follow by email.
  | { status: "processing" }
  | { status: "closed"; context: CheckoutOrderContext }
  | { status: "sold-out"; context: CheckoutOrderContext };

/** Each ticket with its number in the API's (and the email's) order, seated ones sorted by seat. */
function sortTicketsBySeat(tickets: CustomerOrder["tickets"]) {
  const numbered = tickets.map((ticket, i) => ({ ticket, number: i + 1 }));
  if (!tickets.some((ticket) => ticket.seat)) return numbered;
  return [...numbered].sort((a, b) =>
    a.ticket.seat && b.ticket.seat ? compareSeats(a.ticket.seat, b.ticket.seat) : a.ticket.seat ? -1 : b.ticket.seat ? 1 : a.number - b.number,
  );
}

/**
 * The tab's title for each answer (the route's own, "Your order — Sheltüh", stays while it's loading):
 * what happened, never "Order confirmed" for an order that wasn't.
 */
export function confirmationTitle(state: LoadState): string | null {
  switch (state.status) {
    case "loading":
    case "confirming":
      return null;
    case "ready":
      return "Order confirmed — Sheltüh";
    case "oversold":
      return state.order.refundReason === "refunded" ? "Order refunded — Sheltüh" : "Tickets not reserved — Sheltüh";
    case "not-found":
      return "Order not found — Sheltüh";
    case "error":
      return "Something went wrong — Sheltüh";
    case "payment-open":
      return "Payment not completed — Sheltüh";
    case "processing":
      return "Payment processing — Sheltüh";
    case "closed":
      return "Checkout closed — Sheltüh";
    case "sold-out":
      return "Sold out — Sheltüh";
  }
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 12; // ~24s — generous for a webhook that's normally near-instant
/** After this many "still pending" answers, ask once whether the payment went through at all. */
const PAYMENT_CHECK_AFTER_POLLS = 2;

/**
 * /checkout/success (docs/design/brand-direction-one.md §6.9): a quiet,
 * left-aligned single column. The strap says "Order confirmed" with the
 * reference, the event is the h1, then the ticket stubs (no grey wrapper)
 * and the totals card. Every other state is left-aligned too, with its own h1.
 */
export default function CheckoutConfirmation() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const pollCount = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Settled (paid, refunded or oversold, or Stripe has the payment): going Back to the seat page mustn't
  // try to release this order's seats. Not before: a checkout that's still open (payment not
  // completed), or one that closed or sold out, is still released on Back.
  const settled = state.status === "ready" || state.status === "oversold" || state.status === "processing";
  useEffect(() => {
    if (settled && sessionId) forgetPendingCheckout(sessionId);
  }, [settled, sessionId]);

  useEffect(() => {
    let cancelled = false;

    if (!sessionId) {
      // Deferred via queueMicrotask so the effect body itself never calls
      // setState directly — matches the pattern used elsewhere in this app.
      queueMicrotask(() => {
        if (!cancelled) setState({ status: "error", message: "No order reference was given." });
      });
      return () => {
        cancelled = true;
      };
    }

    // What Stripe says about this checkout (read-only, asked once): "processing" when it has the payment.
    let stripeHasPayment = false;

    /**
     * Still pending after a couple of polls: has the buyer paid at all? Coming back from a payment
     * method that redirects (and was cancelled or failed) leaves the checkout open. True when that
     * answered the page (stop polling). Any failure here just lets polling carry on, which reports
     * its own errors.
     */
    async function checkPayment(): Promise<boolean> {
      try {
        const payment = await getOrderPayment(sessionId as string);
        if (cancelled) return true;
        if (payment.status === "processing") {
          stripeHasPayment = true;
          return false;
        }
        if (payment.status === "done") return false;
        const context: CheckoutOrderContext = { eventSlug: payment.eventSlug, seated: payment.seated };
        if (payment.status === "open") {
          setState({
            status: "payment-open",
            context,
            expiresAt: payment.expiresAt,
            eventTimeZone: payment.eventTimeZone,
            eventState: payment.eventState,
          });
        }
        else if (payment.status === "closed") setState({ status: "closed", context });
        else setState({ status: "sold-out", context });
        return true;
      } catch {
        return false;
      }
    }

    async function poll() {
      try {
        const result = await getOrderBySession(sessionId as string);
        if (cancelled) return;

        if (result.status === "pending") {
          pollCount.current += 1;
          if (pollCount.current === PAYMENT_CHECK_AFTER_POLLS && (await checkPayment())) return;
          if (cancelled) return;
          if (pollCount.current >= MAX_POLLS) {
            setState(
              stripeHasPayment
                ? { status: "processing" }
                : {
                    status: "error",
                    message: "Your payment is taking longer than usual to confirm. Refresh this page in a minute, or check your email.",
                  },
            );
            return;
          }
          setState({ status: "confirming" });
          setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        const order = result;
        if (order.status === "paid") {
          setState({ status: "ready", order });
        } else if (order.status === "oversold_refund_required" || order.status === "refunded") {
          setState({ status: "oversold", order });
        } else {
          setState({ status: "error", message: "This order couldn't be completed." });
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setState({ status: "not-found" });
        } else {
          setState({ status: "error", message: "Couldn't load your order right now." });
        }
      }
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const title = confirmationTitle(state);
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  // Focus follows the page's answer when it's a message rather than the tickets (checkout-pay.md §6).
  const messageShown = state.status !== "loading" && state.status !== "confirming" && state.status !== "ready";
  useEffect(() => {
    if (messageShown) headingRef.current?.focus();
  }, [messageShown, state.status]);

  if (state.status === "loading" || state.status === "confirming") {
    return (
      <div className="flex flex-col items-start gap-3 py-10 sm:py-14">
        <LoadingState text="Confirming your order…" />
        <p className="text-sm text-muted">This only takes a moment.</p>
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <StateMessage headingRef={headingRef} title="We couldn’t find that order">
        <p className="max-w-md text-sm text-muted">
          The link may be incomplete or expired. If you were charged, check your email for a receipt from Stripe.
        </p>
      </StateMessage>
    );
  }

  if (state.status === "error") {
    return (
      <StateMessage headingRef={headingRef} title="Something went wrong">
        <p role="alert" className="max-w-md text-sm text-danger">
          {state.message}
        </p>
      </StateMessage>
    );
  }

  if (state.status === "oversold") {
    const refundedAfterPayment = state.order.refundReason === "refunded";
    return (
      <StateMessage headingRef={headingRef} title={refundedAfterPayment ? "This order has been refunded" : "We couldn\u2019t reserve your tickets"}>
        <p className="max-w-md text-sm text-muted">
          {refundedAfterPayment
            ? `Your payment for ${state.order.eventTitle} was refunded, so the tickets for this order are no longer valid.`
            : `${state.order.eventTitle} sold out or stopped taking bookings in the moments between your payment and confirming it. Your payment is being refunded in full \u2014 no tickets were issued for this order.`}
        </p>
      </StateMessage>
    );
  }

  if (state.status === "payment-open") {
    const { context } = state;
    const eventLink = context.eventSlug
      ? { href: eventPathFor(context.eventSlug), label: "Back to the event" }
      : { href: "/", label: "Back to Sheltüh" };
    return (
      <StateMessage
        headingRef={headingRef}
        title="Payment not completed"
        actions={
          <div className="mt-3 flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            {/* A plain link, not next/link: a full page load, so the payment page gets its own document with
                its Content Security Policy (proxy.ts sets it on the document's response only). Arriving, the
                browser reads the new page's title, and focus starts at the top of the page. */}
            <a
              href={`/checkout/pay?order=${encodeURIComponent(sessionId ?? "")}`}
              className={buttonClass("solid", "lg", "w-full sm:w-auto")}
            >
              Return to payment
            </a>
            <Link href={eventLink.href} className={`${linkClass} text-sm`}>
              {eventLink.label}
            </Link>
          </div>
        }
      >
        <p className="max-w-md text-sm text-muted">
          You haven&rsquo;t been charged. Your checkout is still open, so you can try again.
          {context.seated ? ` Your seats are held until ${formatHoldDeadline(state.expiresAt, state.eventTimeZone, state.eventState)}.` : ""}
        </p>
      </StateMessage>
    );
  }

  if (state.status === "processing") {
    return (
      <StateMessage headingRef={headingRef} title="Your payment is processing">
        <p className="max-w-md text-sm text-muted">
          Some payment methods take a little longer to clear. We&rsquo;ll email your tickets as soon as it does; you
          don&rsquo;t need to keep this page open. You won&rsquo;t be charged twice.
        </p>
      </StateMessage>
    );
  }

  if (state.status === "closed") {
    const action = checkoutEndedAction({ ...state.context, seated: false }, CHECKOUT_CLOSED_LABEL);
    return (
      <StateMessage
        headingRef={headingRef}
        title="This checkout has closed"
        actions={
          <Link href={action.href} className={`${linkClass} text-sm`}>
            {action.label}
          </Link>
        }
      >
        <p className="max-w-md text-sm text-muted">{checkoutClosedBody(state.context.seated)}</p>
      </StateMessage>
    );
  }

  if (state.status === "sold-out") {
    const action = checkoutEndedAction(state.context, checkoutSoldOutLabel(state.context.seated));
    return (
      <StateMessage
        headingRef={headingRef}
        title="These tickets have just sold out"
        actions={
          <ButtonLink variant="solid" size="lg" href={action.href} className="w-full sm:w-auto">
            {action.label}
          </ButtonLink>
        }
      >
        <p className="max-w-md text-sm text-muted">{checkoutSoldOutBody(state.context.seated)}</p>
      </StateMessage>
    );
  }

  const { order } = state;
  // An event that's no longer published: no date or venue (the API leaves them out too), and no links to
  // its page, which would be a 404. Unset (an older API) counts as listed.
  const unlisted = order.eventListed === false;
  const eventPath = order.eventSlug && !unlisted ? `/events/${encodeURIComponent(order.eventSlug)}` : null;
  // Each ticket repeats the event, so a screenshot of one says what it's for. Unset from an older API.
  // In the event's zone, naming it outside Melbourne's ("… 11:00 pm Perth time").
  const zone = eventZone(order.eventTimeZone);
  const when =
    order.eventStartsAt && !unlisted
      ? formatEventWhen(order.eventStartsAt, order.eventEndsAt, order.eventTimeZone, order.eventState)
      : undefined;
  const where = unlisted
    ? undefined
    : [order.venueName, order.suburb ? placeName(order.suburb, order.eventState) : ""]
        .filter((part) => !!part?.trim())
        .join(", ") || undefined;
  // The refund policy: only where something was paid (a free order has nothing to refund) and the event is listed.
  const refunds =
    unlisted || order.totalCents <= 0 ? null : refundTermsLine(order.refundPolicy, order.refundDays, order.eventStartsAt, { timeZone: zone });
  return (
    <div className="flex flex-col gap-8 py-10 sm:py-14">
      <div className="flex flex-col gap-3">
        <Strap label="Order confirmed" note={order.reference} />
        <h1 className="display-md break-words">{order.eventTitle}</h1>
        {order.maskedEmail && (
          <p className="text-sm text-muted">We&rsquo;re emailing your tickets to {order.maskedEmail}.</p>
        )}
      </div>

      <section aria-labelledby="your-tickets" className="flex flex-col gap-3">
        <h2 id="your-tickets" className="font-heading text-xl text-foreground">
          Your tickets
        </h2>
        <ul className="flex flex-col gap-3">
          {/* Numbered as in the ticket email and at the door: both order an order's
              tickets by ticket type, then code, as the API returns them. */}
          {/* Seated tickets are listed by section, row, then seat (docs/design/seating.md §5.15),
              keeping their numbers from the email's order. */}
          {sortTicketsBySeat(order.tickets).map(({ ticket, number }) => (
            <TicketStub
              key={ticket.ticketCode}
              code={ticket.ticketCode}
              typeName={ticket.ticketTypeName}
              ticketNumber={number}
              ticketCount={order.tickets.length}
              seat={ticket.seat}
              eventTitle={order.eventTitle}
              when={when}
              where={where}
              eventUnlisted={unlisted}
              checkedInAt={ticket.checkedInAt}
              timeZone={zone}
            />
          ))}
        </ul>
        {/* Add to Apple / Google Wallet, per ticket, only for the wallets the server has on (order.wallet: set only
            for a paid order of a listed event, as the pass routes require). Numbered as the stubs and the email
            (the route takes the number). */}
        {sessionId && !unlisted && (order.wallet?.apple || order.wallet?.google) && (
          <ul className="flex flex-col gap-3 print:hidden" aria-label="Add to your phone's wallet">
            {sortTicketsBySeat(order.tickets).map(({ ticket, number }) => (
              <li key={ticket.ticketCode} className="flex flex-col gap-1">
                {order.tickets.length > 1 && (
                  <p className="text-xs text-muted">
                    Ticket {number} of {order.tickets.length} · {ticket.ticketTypeName}
                  </p>
                )}
                <WalletButtons
                  sessionId={sessionId}
                  wallet={order.wallet}
                  ticketNumber={number}
                  ticketCount={order.tickets.length}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1 text-xs text-muted">
          <p>Show a QR code at the door, from this page or your ticket email.</p>
          <p>This page needs a connection. If signal at the venue is patchy, take a screenshot first.</p>
          <p>Each code gets in once, so don&rsquo;t post or share it.</p>
          <p>Order reference {order.reference}</p>
        </div>
      </section>

      {/* The totals card (brand-direction-one.md §6.9). */}
      <div className="rounded-card border border-foreground bg-card p-4">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Ticket subtotal</dt>
            <dd className="tabular-nums text-foreground">{formatAud(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted">Booking fees</dt>
            <dd className="tabular-nums text-foreground">{formatAud(order.buyerFeeCents)}</dd>
          </div>
          {/* Only when they added some (unset otherwise, and from an older API); in the total paid. */}
          <SupportSummaryLine cents={order.supportCents} />
          {/* The total is the largest number here (brand-direction-one.md §6.8). */}
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-foreground pt-3">
            <dt className="text-lg leading-6 font-bold text-foreground">Total paid</dt>
            <dd className="text-xl leading-7 font-bold tabular-nums text-foreground">{formatAud(order.totalCents)}</dd>
          </div>
        </dl>
        {order.supportCents !== undefined && order.supportCents > 0 && (
          <p className="mt-3 text-sm text-foreground">Thanks for supporting Sheltüh.</p>
        )}
        {/* The event's refund policy (the API sends it for listed events only). */}
        {refunds && (
          <div data-refund-policy="" className="mt-4 flex flex-col gap-1 border-t border-surface-border pt-3 text-sm">
            <p className="text-foreground">
              <span className="font-semibold">Refund policy:</span> {refunds}
            </p>
            {order.supportCents !== undefined && order.supportCents > 0 && (
              <p className="text-foreground">{SUPPORT_REFUND_NOTE}</p>
            )}
            <p className="text-sm text-muted">{REFUND_ACL_STATEMENT}</p>
            <p className="text-xs text-muted">
              To ask for one, use{" "}
              <Link href="/refunds" className="text-foreground underline underline-offset-2">
                Request a refund
              </Link>
              .
            </p>
          </div>
        )}
      </div>

      {eventPath ? (
        <div className="flex flex-col items-start gap-3">
          <p className="text-sm text-muted">Want people to know you&rsquo;re going?</p>
          <ButtonLink variant="outline" size="lg" href={`${eventPath}#whos-going`} className="w-full sm:w-auto">
            Add yourself to Who&rsquo;s Going
          </ButtonLink>
          <p className="flex flex-wrap gap-x-6 text-sm">
            <Link href={eventPath} className={linkClass}>
              Back to the event
            </Link>
            <Link href="/" className={linkClass}>
              Back to Sheltüh
            </Link>
          </p>
        </div>
      ) : (
        <Link href="/" className={`${linkClass} self-start text-sm`}>
          Back to Sheltüh
        </Link>
      )}
    </div>
  );
}

const linkClass = "inline-flex min-h-11 items-center text-accent underline underline-offset-4";

/**
 * A state that ends the page (not found, an error, a refund, a checkout not paid): left-aligned, with its
 * own h1 (focused when it appears) and a way out: `actions`, or "Back to Sheltüh".
 */
function StateMessage({
  title,
  children,
  actions,
  headingRef,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex flex-col items-start gap-3 py-10 sm:py-14">
      {/* Focused by script to say what happened (tabIndex -1); it's not a control, so no focus ring. Important
          (`!`): the global :focus-visible ring in globals.css is unlayered, so it beats any utility otherwise. */}
      <h1 ref={headingRef} tabIndex={-1} className="display-md text-balance outline-offset-2 focus:outline-none!">
        {title}
      </h1>
      {children}
      {actions ?? (
        <Link href="/" className={`${linkClass} text-sm`}>
          Back to Sheltüh
        </Link>
      )}
    </div>
  );
}

"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode, type Ref } from "react";
import { flushSync } from "react-dom";
import OrderEmail from "@/components/checkout/OrderEmail";
import { useOptionalNavAccount } from "@/components/nav/useNavAccount";
import MyTicketView from "@/components/tickets/MyTicketView";
import SendTicketDialog, { type SendTicketFields } from "@/components/tickets/SendTicketDialog";
import { useTicketEvent } from "@/components/tickets/useTicketEvent";
import { ButtonLink, buttonClass } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import Toast, { useToast } from "@/components/ui/Toast";
import { orderCompletedProperties, trackOrderCompleted } from "@/lib/analytics";
import { ApiError } from "@/lib/api/client";
import type { GetToken } from "@/lib/api/client";
import { getOrderBySession, getOrderPayment } from "@/lib/api/orders";
import { cancelTicketTransfer, sendTicket } from "@/lib/api/ticket-transfers";
import { useOptionalAuth } from "@/lib/auth/useOptionalAuth";
import {
  CHECKOUT_CLOSED_LABEL,
  CHECKOUT_UNCONFIRMED_BODY,
  CHECKOUT_UNCONFIRMED_TITLE,
  checkoutClosedBody,
  checkoutEndedAction,
  checkoutSoldOutBody,
  checkoutSoldOutLabel,
  eventPathFor,
  formatHoldDeadline,
  type CheckoutOrderContext,
} from "@/lib/checkout-pay";
import { forgetOrderAccessIfFinal, orderAccessFor } from "@/lib/order-access";
import { firstName } from "@/lib/person-name";
import { withNext } from "@/lib/safe-next-path";
import { formatSeatLine } from "@/lib/seating/format";
import { forgetPendingCheckout } from "@/lib/seating/pending-checkout";
import { rememberReturnOrder, sendParam, takeReturnOrder } from "@/lib/ticket-transfer-return";
import type { CustomerOrder, StateCode } from "@/lib/api/types";

export type LoadState =
  | { status: "loading" }
  | { status: "confirming" } // paid on Stripe's side, waiting on our webhook to land
  // `access`: this browser's order access token, when it paid for the order (lib/order-access.ts).
  | { status: "ready"; order: CustomerOrder; access?: string }
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
  // The checkout's time ran out and the server couldn't ask Stripe whether it was paid (closed, reason
  // `unconfirmed`), and the order still wasn't paid after polling: the tickets may still come by email.
  | { status: "unconfirmed"; context: CheckoutOrderContext }
  | { status: "sold-out"; context: CheckoutOrderContext };

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
    case "unconfirmed":
      return "Payment not confirmed — Sheltüh";
    case "sold-out":
      return "Sold out — Sheltüh";
  }
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 12; // ~24s — generous for a webhook that's normally near-instant
/** After this many "still pending" answers, ask once whether the payment went through at all. */
const PAYMENT_CHECK_AFTER_POLLS = 2;

/**
 * /checkout/success: the buyer's ticket page, opened by the order id in its
 * URL (from checkout, and from the ticket email). A paid order is the My
 * ticket page (components/tickets/MyTicketView.tsx: Latte's 1120 frames
 * around the orange-outline ticket). Every other answer (still confirming,
 * not found, refunded, payment not completed, closed, sold out) is a quiet
 * left-aligned message with its own h1.
 */
export default function CheckoutConfirmation() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const router = useRouter();
  // `?send=2`: open Send for ticket 2 once the order is in (back from signing in to send, or an offer email's link).
  const sendAsked = sendParam(searchParams.get("send"));
  // Signed in, the order is read with the account's token too: signed in with the buying email, the page may
  // send the order's tickets (docs/architecture.md, "Ticket transfers"). Outside an AuthProvider: signed out.
  const auth = useOptionalAuth();
  const signedIn = Boolean(auth?.configured && auth.status === "signed-in");
  const accountKey = signedIn ? (auth?.userId ?? "") : null;
  const getToken: GetToken | undefined = signedIn ? auth?.getAccessToken : undefined;
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  const navAccount = useOptionalNavAccount();
  const toast = useToast();
  /** The ticket (its number) the Send dialog is open for. */
  const [sendFor, setSendFor] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);
  const [transferError, setTransferError] = useState<{ ticketNumber: number; message: string } | null>(null);
  /** Back from signing in to send: the order id this tab kept (read once: it's forgotten as it's read). */
  const returnOrder = useRef<string | null | undefined>(undefined);
  /**
   * Counts the requests whose answer replaces the order on the page (a send, a cancel, a quiet re-read): only
   * the latest one's answer is shown, so a slow re-read can't put back what a newer answer changed.
   */
  const answerSeq = useRef(0);
  // What the page has loaded, with the session_id and the visit (each run of the load below) it was loaded
  // for. Another session_id in the same tab (the component stays mounted) is loading until its own answer is
  // in: never the previous order's tickets, token or settled effects under the new URL.
  const [loaded, setLoaded] = useState<{ sessionId: string | null; visit: number; state: LoadState }>({
    sessionId,
    visit: 0,
    state: { status: "loading" },
  });
  const state: LoadState = loaded.sessionId === sessionId ? loaded.state : { status: "loading" };
  const pollCount = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The visit the page is on now: an email change's answer from an earlier one (another order, or this one
  // before the tab went elsewhere and came back) isn't shown.
  const currentVisit = useRef(0);

  // Settled (paid, refunded or oversold, or Stripe has the payment): going Back to the seat page mustn't
  // try to release this order's seats. Not before: a checkout that's still open (payment not
  // completed), or one that closed or sold out, is still released on Back.
  const settled = state.status === "ready" || state.status === "oversold" || state.status === "processing";
  useEffect(() => {
    if (settled && sessionId) forgetPendingCheckout(sessionId);
  }, [settled, sessionId]);

  // Usage analytics: order_completed once, for the visit that checked out. This page is also the
  // ticket page the buyer opens again from their email, so it only counts when this tab started the
  // order's checkout (lib/analytics.ts rememberCheckoutStarted). The order id is only the lookup
  // key (a short fingerprint is kept for it); it is never sent.
  const paidOrder = state.status === "ready" ? state.order : null;
  useEffect(() => {
    if (paidOrder && sessionId) trackOrderCompleted(sessionId, orderCompletedProperties(paidOrder));
  }, [paidOrder, sessionId]);
  // The event's public details (image, street address, map links) for a listed event's tickets: optional extras.
  const ticketEvent = useTicketEvent(paidOrder && paidOrder.eventListed !== false ? paidOrder.eventSlug : null);

  useEffect(() => {
    let cancelled = false;
    const visit = (currentVisit.current += 1);
    pollCount.current = 0;
    const setState = (next: LoadState) => setLoaded({ sessionId, visit, state: next });

    if (!sessionId) {
      // Back from signing in to send a ticket: this tab kept the order's id (never in the sign-in's `next`).
      if (returnOrder.current === undefined) returnOrder.current = takeReturnOrder();
      if (returnOrder.current) {
        const params = new URLSearchParams({ session_id: returnOrder.current });
        if (sendAsked) params.set("send", String(sendAsked));
        router.replace(`/checkout/success?${params}`);
        return () => {
          cancelled = true;
        };
      }
      // Deferred via queueMicrotask so the effect body itself never calls
      // setState directly — matches the pattern used elsewhere in this app.
      queueMicrotask(() => {
        if (!cancelled) setState({ status: "error", message: "No order reference was given." });
      });
      return () => {
        cancelled = true;
      };
    }

    // This browser's order access token, if it paid for the order (lib/order-access.ts): sent on every read, so
    // the answer carries the full email and whether it can be changed.
    const access = orderAccessFor(sessionId);

    // What Stripe says about this checkout (read-only, asked once): "processing" when it has the payment.
    let stripeHasPayment = false;
    // Closed with reason `unconfirmed`: the server couldn't ask Stripe. Polling carries on (a payment Stripe
    // took still reaches the order); if it never does, the page says it couldn't confirm, never "not charged".
    let unconfirmed: CheckoutOrderContext | null = null;

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
        if (payment.status === "closed" && payment.reason === "unconfirmed") {
          unconfirmed = context;
          return false;
        }
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
        const result = await readOrder(sessionId as string, access, getTokenRef.current);
        if (cancelled) return;

        if (result.status === "pending") {
          pollCount.current += 1;
          if (pollCount.current === PAYMENT_CHECK_AFTER_POLLS && (await checkPayment())) return;
          if (cancelled) return;
          if (pollCount.current >= MAX_POLLS) {
            setState(
              stripeHasPayment
                ? { status: "processing" }
                : unconfirmed
                  ? { status: "unconfirmed", context: unconfirmed }
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
          // The server says the token can't change anything any more: this device stops keeping it.
          if (access) forgetOrderAccessIfFinal(sessionId as string, order.emailChange, needsAccessForTickets(order));
          setState({ status: "ready", order, access });
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
  }, [sessionId, sendAsked, router]);

  /**
   * Shows a later answer for the order on the page (a send's, a cancel's, a quiet reload's), if the page is
   * still on that order and visit and showing its tickets: paid stays here; refunded gets its own page.
   * False when a newer request (or an account change) made this answer stale: it isn't shown.
   */
  function applyOrder(next: CustomerOrder, forSession: string, forVisit: number, seq: number): boolean {
    // The token is this order's: forgotten when final, whatever the page shows by now.
    forgetOrderAccessIfFinal(forSession, next.emailChange, needsAccessForTickets(next));
    if (seq !== answerSeq.current) return false;
    setLoaded((was) => {
      if (was.sessionId !== forSession || was.visit !== forVisit || was.state.status !== "ready") return was;
      const access = was.state.access;
      if (next.status === "paid") return { ...was, state: { status: "ready", order: next, access } };
      if (next.status === "oversold_refund_required" || next.status === "refunded") return { ...was, state: { status: "oversold", order: next } };
      return { ...was, state: { status: "error", message: "This order couldn't be completed." } };
    });
    return true;
  }

  /** Reads the order again without a loading state (it changed under the page: an offer taken, control lost). */
  function reloadQuietly(forSession: string, forVisit: number) {
    const seq = (answerSeq.current += 1);
    readOrder(forSession, orderAccessFor(forSession), getTokenRef.current).then(
      (result) => {
        if (result.status !== "pending") applyOrder(result, forSession, forVisit, seq);
      },
      () => {
        // The page keeps what it shows; the next action says what's wrong, if anything still is.
      },
    );
  }

  // The account changed under the page (signed in, signed out, or another account in another tab): an answer
  // still on its way for the previous one isn't shown, and an order on the page is read again with the access
  // there is now, so what only the previous account may see (recipients' names, send, cancel) goes. Also,
  // signed in when the order came back saying to sign in (read before the session was restored): read it
  // again, so the account's control of it shows.
  const readyOrder = state.status === "ready" ? state.order : null;
  const hasOrder = readyOrder !== null;
  const needsControl = readyOrder?.transfers?.reason === "sign_in";
  const readForAccount = useRef(accountKey);
  const reloadForAccount = useEffectEvent((forSession: string) => reloadQuietly(forSession, currentVisit.current));
  useEffect(() => {
    const accountChanged = readForAccount.current !== accountKey;
    readForAccount.current = accountKey;
    if (accountChanged) answerSeq.current += 1;
    if (!sessionId) return;
    if (accountChanged ? hasOrder : accountKey !== null && needsControl) reloadForAccount(sessionId);
  }, [sessionId, accountKey, needsControl, hasOrder]);

  // `?send=n`: open Send for ticket n once, when the order says it can be sent now.
  const autoOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!sendAsked || !sessionId || !readyOrder?.transfers?.canSend) return;
    const key = `${sessionId}#${sendAsked}`;
    if (autoOpened.current === key) return;
    const ticket = readyOrder.tickets.find((t, i) => (t.ticketNumber ?? i + 1) === sendAsked);
    if (!ticket || ticket.canSend !== true) return;
    autoOpened.current = key;
    queueMicrotask(() => setSendFor(sendAsked));
  }, [sendAsked, sessionId, readyOrder]);

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
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <StateMessage headingRef={headingRef} title="We couldn’t find that order">
        <p className="max-w-md text-sm text-muted">
          If you were charged, check your email for a Stripe receipt.
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
            : `${state.order.eventTitle} sold out or stopped taking bookings before your payment was confirmed. You\u2019re being refunded in full. No tickets were issued.`}
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
          You haven&rsquo;t been charged.
          {context.seated ? ` Your seats are held until ${formatHoldDeadline(state.expiresAt, state.eventTimeZone, state.eventState)}.` : ""}
        </p>
      </StateMessage>
    );
  }

  if (state.status === "processing") {
    return (
      <StateMessage headingRef={headingRef} title="Your payment is processing">
        <p className="max-w-md text-sm text-muted">
          We&rsquo;ll email your tickets once it clears. You won&rsquo;t be charged twice.
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

  if (state.status === "unconfirmed") {
    const action = checkoutEndedAction({ ...state.context, seated: false }, CHECKOUT_CLOSED_LABEL);
    return (
      <StateMessage
        headingRef={headingRef}
        title={CHECKOUT_UNCONFIRMED_TITLE}
        actions={
          <Link href={action.href} className={`${linkClass} text-sm`}>
            {action.label}
          </Link>
        }
      >
        <p className="max-w-md text-sm text-muted">{CHECKOUT_UNCONFIRMED_BODY}</p>
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

  const { order, access } = state;
  const transfers = order.transfers;
  const visit = loaded.visit;

  async function send(fields: SendTicketFields) {
    if (!sessionId || sendFor === null) return;
    const seq = (answerSeq.current += 1);
    const result = await sendTicket(sessionId, { ticket: sendFor, ...fields }, access, getTokenRef.current);
    // The dialog closes first (its focus goes back to what opened it, and the page is no longer inert behind a
    // modal), so the toast after it is read out.
    flushSync(() => setSendFor(null));
    // Its answer went stale on the way (the account changed, and a read for it may have come back before the
    // send went through): it isn't shown, but the page reads the order again, so it shows the send.
    if (!applyOrder(result.order, sessionId, visit, seq)) reloadQuietly(sessionId, visit);
    toast.show(`Sent to ${firstName(fields.name)}. We’ll email you when they accept.`);
  }

  async function cancel(ticketNumber: number, transferId: string) {
    if (!sessionId) return;
    setCancelling(ticketNumber);
    setTransferError(null);
    const seq = (answerSeq.current += 1);
    try {
      const result = await cancelTicketTransfer(sessionId, transferId, access, getTokenRef.current);
      // A stale answer (as for a send): read the order again, so the offer cancelled doesn't stay on the page.
      if (!applyOrder(result.order, sessionId, visit, seq)) reloadQuietly(sessionId, visit);
      toast.show("Cancelled. Your QR code still works.");
    } catch (err) {
      const known = err instanceof ApiError && err.status < 500;
      setTransferError({ ticketNumber, message: known ? err.message : "Couldn’t cancel it. Try again." });
      // Accepted, declined or expired meanwhile, or this browser lost control: show the order as it is now.
      if (known) reloadQuietly(sessionId, visit);
    } finally {
      setCancelling(null);
    }
  }

  /**
   * Sign in with the buying email to send ticket `ticketNumber`: back here after, with Send open for it. Signed
   * in with another email, this signs out on this device first (Switch account).
   */
  function signInToSend(ticketNumber: number) {
    if (!sessionId) return;
    rememberReturnOrder(sessionId);
    if (signedIn) auth?.signOut("local");
    router.push(withNext("/login", `/checkout/success?send=${ticketNumber}`));
  }

  const offered = order.tickets.some((ticket) => ticket.transfer);
  const entriesCount = order.tickets.length + (order.transferredTickets?.length ?? 0);
  const sendTicketLabel = (() => {
    if (sendFor === null || entriesCount < 2) return undefined;
    const ticket = order.tickets.find((t, i) => (t.ticketNumber ?? i + 1) === sendFor);
    return [`Ticket ${sendFor} of ${entriesCount}`, ticket?.seat ? formatSeatLine(ticket.seat) : null].filter(Boolean).join(" · ");
  })();

  return (
    <>
      <MyTicketView
        order={order}
        sessionId={sessionId}
        event={ticketEvent}
        onSendTicket={
          sessionId && transfers?.canSend
            ? (ticketNumber) => {
                setTransferError(null);
                setSendFor(ticketNumber);
              }
            : undefined
        }
        onSignInToSend={sessionId && transfers?.reason === "sign_in" ? signInToSend : undefined}
        signedInAsOther={signedIn}
        showTicket={sendAsked}
        onCancelTransfer={sessionId ? (ticketNumber, transferId) => void cancel(ticketNumber, transferId) : undefined}
        cancelling={cancelling}
        transferError={transferError}
        // Where a ticket can be sent or taken back, and while a toast is up (a cancel with sending off): the page's
        // other news has its own status lines.
        toast={transfers || offered || toast.toast ? (placement) => <Toast controls={toast} placement={placement} /> : undefined}
        emailSlot={
          sessionId && (
            <OrderEmail
              // A fresh form for each visit: nothing typed for one order (or an earlier visit) is sent for another.
              key={`${sessionId}#${loaded.visit}`}
              sessionId={sessionId}
              order={order}
              access={state.access}
              onOrder={(next) => {
                // The token is this order's: forgotten when final, whatever the page shows by now.
                forgetOrderAccessIfFinal(sessionId, next.emailChange, needsAccessForTickets(next));
                if (currentVisit.current !== loaded.visit) return;
                const show = (shown: LoadState) => setLoaded({ sessionId, visit: loaded.visit, state: shown });
                // As the load does: paid stays here; refunded (say, while the change was being sent) gets its own page.
                if (next.status === "paid") show({ status: "ready", order: next, access: state.access });
                else if (next.status === "oversold_refund_required" || next.status === "refunded") show({ status: "oversold", order: next });
                else show({ status: "error", message: "This order couldn't be completed." });
              }}
              onUnavailable={(message) => {
                if (currentVisit.current === loaded.visit) setLoaded({ sessionId, visit: loaded.visit, state: { status: "error", message } });
              }}
            />
          )
        }
      />
      <SendTicketDialog
        open={sendFor !== null}
        onClose={() => setSendFor(null)}
        ticketLabel={sendTicketLabel}
        defaultSenderName={navAccount?.profile?.displayName ?? ""}
        onSend={send}
        onSignIn={() => {
          if (sendFor !== null) signInToSend(sendFor);
        }}
      />
    </>
  );
}

/** The order read with this browser's token and, when signed in, the account's (only the arguments there are). */
function readOrder(sessionId: string, access: string | undefined, getToken: GetToken | undefined) {
  return getToken ? getOrderBySession(sessionId, access, getToken) : getOrderBySession(sessionId, access);
}

/**
 * Whether this browser's order access token still does something for the order's tickets: it may send one
 * now, or cancel an offer. A scanned ticket then doesn't end it (lib/order-access.ts forgetOrderAccessIfFinal).
 */
function needsAccessForTickets(order: CustomerOrder): boolean {
  return order.transfers?.canSend === true || order.tickets.some((ticket) => ticket.transfer?.canCancel === true);
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

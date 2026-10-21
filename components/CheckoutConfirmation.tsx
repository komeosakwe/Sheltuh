"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import TicketStub from "@/components/tickets/TicketStub";
import { ButtonLink } from "@/components/ui/Button";
import { LoadingState } from "@/components/ui/ProgressLoader";
import Strap from "@/components/ui/Strap";
import { ApiError } from "@/lib/api/client";
import { getOrderBySession } from "@/lib/api/orders";
import { formatAud } from "@/lib/format";
import { compareSeats } from "@/lib/seating/format";
import type { CustomerOrder } from "@/lib/api/types";

type LoadState =
  | { status: "loading" }
  | { status: "confirming" } // paid on Stripe's side, waiting on our webhook to land
  | { status: "ready"; order: CustomerOrder }
  | { status: "oversold"; order: CustomerOrder }
  | { status: "not-found" }
  | { status: "error"; message: string };

/** Each ticket with its number in the API's (and the email's) order, seated ones sorted by seat. */
function sortTicketsBySeat(tickets: CustomerOrder["tickets"]) {
  const numbered = tickets.map((ticket, i) => ({ ticket, number: i + 1 }));
  if (!tickets.some((ticket) => ticket.seat)) return numbered;
  return [...numbered].sort((a, b) =>
    a.ticket.seat && b.ticket.seat ? compareSeats(a.ticket.seat, b.ticket.seat) : a.ticket.seat ? -1 : b.ticket.seat ? 1 : a.number - b.number,
  );
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 12; // ~24s — generous for a webhook that's normally near-instant

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

    async function poll() {
      try {
        const result = await getOrderBySession(sessionId as string);
        if (cancelled) return;

        if (result.status === "pending") {
          pollCount.current += 1;
          if (pollCount.current >= MAX_POLLS) {
            setState({
              status: "error",
              message: "Your payment is taking longer than usual to confirm. Refresh this page in a minute, or check your email.",
            });
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
      <StateMessage title="We couldn’t find that order">
        <p className="max-w-md text-sm text-muted">
          The link may be incomplete or expired. If you were charged, check your email for a receipt from Stripe.
        </p>
      </StateMessage>
    );
  }

  if (state.status === "error") {
    return (
      <StateMessage title="Something went wrong">
        <p role="alert" className="max-w-md text-sm text-danger">
          {state.message}
        </p>
      </StateMessage>
    );
  }

  if (state.status === "oversold") {
    const refundedAfterPayment = state.order.refundReason === "refunded";
    return (
      <StateMessage title={refundedAfterPayment ? "This order has been refunded" : "We couldn\u2019t reserve your tickets"}>
        <p className="max-w-md text-sm text-muted">
          {refundedAfterPayment
            ? `Your payment for ${state.order.eventTitle} was refunded, so the tickets for this order are no longer valid.`
            : `${state.order.eventTitle} sold out or stopped taking bookings in the moments between your payment and confirming it. Your payment is being refunded in full \u2014 no tickets were issued for this order.`}
        </p>
      </StateMessage>
    );
  }

  const { order } = state;
  const eventPath = order.eventSlug ? `/events/${encodeURIComponent(order.eventSlug)}` : null;
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
            />
          ))}
        </ul>
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
          {/* The total is the largest number here (brand-direction-one.md §6.8). */}
          <div className="mt-1 flex items-baseline justify-between gap-4 border-t border-foreground pt-3">
            <dt className="text-lg leading-6 font-bold text-foreground">Total paid</dt>
            <dd className="text-xl leading-7 font-bold tabular-nums text-foreground">{formatAud(order.totalCents)}</dd>
          </div>
        </dl>
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

/** A state that ends the page (not found, an error, a refund): left-aligned, with its own h1 and a way back. */
function StateMessage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-10 sm:py-14">
      <h1 className="display-md">{title}</h1>
      {children}
      <Link href="/" className={`${linkClass} text-sm`}>
        Back to Sheltüh
      </Link>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { getOrderBySession } from "@/lib/api/orders";
import { formatAud } from "@/lib/format";
import type { OrderRecord } from "@/lib/api/types";

type LoadState =
  | { status: "loading" }
  | { status: "confirming" } // paid on Stripe's side, waiting on our webhook to land
  | { status: "ready"; order: OrderRecord }
  | { status: "oversold"; order: OrderRecord }
  | { status: "not-found" }
  | { status: "error"; message: string };

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 12; // ~24s — generous for a webhook that's normally near-instant

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

        const order = result as OrderRecord;
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
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="font-heading text-2xl text-foreground">Confirming your order&hellip;</p>
        <p className="text-sm text-muted">This only takes a moment.</p>
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="font-heading text-2xl text-foreground">We couldn&rsquo;t find that order</p>
        <p className="max-w-md text-sm text-muted">
          The link may be incomplete or expired. If you were charged, check your email for a receipt from Stripe.
        </p>
        <Link href="/" className="mt-2 text-accent underline underline-offset-2">
          Back to Sheltüh
        </Link>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="font-heading text-2xl text-foreground">Something went wrong</p>
        <p role="alert" className="max-w-md text-sm text-danger">
          {state.message}
        </p>
        <Link href="/" className="mt-2 text-accent underline underline-offset-2">
          Back to Sheltüh
        </Link>
      </div>
    );
  }

  if (state.status === "oversold") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="font-heading text-2xl text-foreground">We couldn&rsquo;t reserve your tickets</p>
        <p className="max-w-md text-sm text-muted">
          {state.order.eventTitle} sold out in the moments between your payment and confirming it. Your payment is
          being refunded — no tickets were issued for this order.
        </p>
        <Link href="/" className="mt-2 text-accent underline underline-offset-2">
          Back to Sheltüh
        </Link>
      </div>
    );
  }

  const { order } = state;
  return (
    <div className="flex flex-col gap-6 py-10">
      <div className="flex flex-col items-center gap-2 text-center">
        <p className="text-sm font-medium uppercase tracking-wide text-accent">Order confirmed</p>
        <h1 className="font-heading text-3xl text-foreground sm:text-4xl">{order.eventTitle}</h1>
        {order.buyerEmail && <p className="text-sm text-muted">A receipt was sent to {order.buyerEmail}.</p>}
      </div>

      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <h2 className="font-heading text-xl text-foreground">Your tickets</h2>
        <ul className="mt-3 flex flex-col gap-2">
          {order.tickets.map((ticket) => (
            <li
              key={ticket.ticketCode}
              className="flex items-center justify-between rounded border border-surface-border bg-background px-3 py-2"
            >
              <span className="text-sm text-foreground">{ticket.ticketTypeName}</span>
              <span className="font-mono text-sm tracking-wider text-accent">{ticket.ticketCode}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">Show this page or your email receipt at the door.</p>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface p-4">
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Ticket subtotal</dt>
            <dd className="text-foreground">{formatAud(order.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Booking fees</dt>
            <dd className="text-foreground">{formatAud(order.buyerFeeCents)}</dd>
          </div>
          <div className="flex justify-between border-t border-surface-border pt-2 font-semibold">
            <dt className="text-foreground">Total paid</dt>
            <dd className="text-foreground">{formatAud(order.totalCents)}</dd>
          </div>
        </dl>
      </div>

      <Link href="/" className="self-center text-accent underline underline-offset-2">
        Back to Sheltüh
      </Link>
    </div>
  );
}

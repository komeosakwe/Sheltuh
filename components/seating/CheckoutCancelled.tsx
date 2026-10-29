"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { cancelPendingOrder } from "@/lib/api/seating";
import { SEAT_HOLD, type CancelOrderResult } from "@/lib/api/types";
import { forgetPendingCheckout } from "@/lib/seating/pending-checkout";

type State =
  | { status: "releasing" }
  | { status: "done"; result: CancelOrderResult }
  | { status: "not-found" }
  | { status: "error"; attempt: number };

const linkClass = "inline-flex min-h-11 items-center text-sm text-foreground underline underline-offset-4";

/**
 * /checkout/cancelled?order={orderId} (docs/design/seating.md §5.12): the
 * buyer left Stripe's page, so the order is cancelled and its held seats
 * released straight away (POST /api/orders/by-session/{id}/cancel, safe to
 * repeat). No orange: a checkout page. The h1 ("Checkout cancelled", with
 * the event above it) is there while releasing, and takes focus once
 * there's an answer.
 */
export default function CheckoutCancelled() {
  const orderId = useSearchParams().get("order");
  const [state, setState] = useState<State>({ status: "releasing" });
  const [retrying, setRetrying] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const started = useRef<string | null>(null);

  const release = useCallback(async (id: string, attempt: number) => {
    try {
      const result = await cancelPendingOrder(id);
      setState({ status: "done", result });
    } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? { status: "not-found" } : { status: "error", attempt });
    } finally {
      setRetrying(false);
    }
  }, []);

  useEffect(() => {
    // Once per order id (Strict Mode runs effects twice in development; the call is safe to repeat anyway).
    if (!orderId || !isApiConfigured || started.current === orderId) return;
    started.current = orderId;
    // Released here: the seat page has nothing left to release when the buyer goes back to it.
    forgetPendingCheckout(orderId);
    void release(orderId, 0);
  }, [orderId, release]);

  useEffect(() => {
    if (state.status !== "releasing") headingRef.current?.focus();
  }, [state.status]);

  if (!orderId || !isApiConfigured) {
    return (
      <div className="flex flex-col items-start gap-3 py-10 sm:py-14">
        <h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl outline-offset-2">
          Nothing to cancel
        </h1>
        <p className="max-w-md text-sm text-muted">
          {isApiConfigured ? "This link is missing its order reference." : "Demo only. Nothing was held."}
        </p>
        <Link href="/" className={linkClass}>
          Back to Sheltüh
        </Link>
      </div>
    );
  }

  if (state.status === "releasing") {
    return (
      <div className="flex flex-col items-start gap-4 py-10 sm:py-14">
        <h1 className="font-heading text-2xl">Checkout cancelled</h1>
        <DotsLoader announce label="Releasing your seats" />
      </div>
    );
  }

  if (state.status === "not-found") {
    return (
      <div className="flex flex-col items-start gap-3 py-10 sm:py-14">
        <h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl outline-offset-2">
          We couldn&rsquo;t find that checkout
        </h1>
        <p className="max-w-md text-sm text-muted">
          Held seats are released within {SEAT_HOLD.holdMinutes} minutes. You weren&rsquo;t charged.
        </p>
        <Link href="/" className={linkClass}>
          Back to Sheltüh
        </Link>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-col items-start gap-4 py-10 sm:py-14">
        <h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl outline-offset-2">
          Checkout cancelled
        </h1>
        <Notice key={state.attempt} tone="danger" role="alert">
          Couldn&rsquo;t release your seats. They&rsquo;re released within {SEAT_HOLD.holdMinutes} minutes. You weren&rsquo;t
          charged.
        </Notice>
        <Button
          variant="outline"
          size="lg"
          busy={retrying}
          onClick={() => {
            setRetrying(true);
            void release(orderId, state.attempt + 1);
          }}
        >
          {retrying ? "Trying again…" : "Try again"}
        </Button>
        <Link href="/" className={linkClass}>
          Back to Sheltüh
        </Link>
      </div>
    );
  }

  const { result } = state;
  const eventPath = result.eventSlug ? `/events/${encodeURIComponent(result.eventSlug)}` : null;
  if (result.status !== "released") {
    return (
      <div className="flex flex-col items-start gap-4 py-10 sm:py-14">
        <p className="eyebrow w-full border-t border-foreground pt-2">{result.eventTitle}</p>
        <h1 ref={headingRef} tabIndex={-1} className="font-heading text-2xl outline-offset-2">
          {result.status === "paid" ? "This order is already paid" : "Your payment is being confirmed"}
        </h1>
        <p className="max-w-md text-sm text-muted">
          {result.status === "paid"
            ? "Your tickets are ready on the confirmation page."
            : "Stripe has your payment. Your tickets will show on the order page."}
        </p>
        <ButtonLink variant="solid" size="lg" href={`/checkout/success?session_id=${encodeURIComponent(orderId)}`} className="w-full sm:w-auto">
          See your order
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-4 py-10 sm:py-14">
      <p className="eyebrow w-full border-t border-foreground pt-2 break-words">{result.eventTitle}</p>
      <h1 ref={headingRef} tabIndex={-1} className="display-md outline-offset-2">
        Checkout cancelled
      </h1>
      <p className="max-w-md text-base leading-6">You weren&rsquo;t charged. Your seats were released.</p>
      {eventPath && (
        <>
          <ButtonLink variant="solid" size="lg" href={`${eventPath}/seats`} className="w-full sm:w-auto">
            Choose seats again
          </ButtonLink>
          <Link href={eventPath} className={linkClass}>
            Back to the event
          </Link>
        </>
      )}
    </div>
  );
}

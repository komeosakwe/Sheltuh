"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { getStripe } from "@/lib/stripe/browser";

type ScriptState = { status: "loading" } | { status: "loaded"; stripe: Stripe } | { status: "failed" };

/**
 * The white slot holding Stripe's embedded Checkout form
 * (docs/design/checkout-pay.md §5.4). Stripe.js is loaded first, and the
 * provider is mounted only once it has: the provider reports no errors, so a
 * script that can't load (offline, a content blocker) gets our own message
 * and a "Try again" here instead of a loader that never ends.
 *
 * Nothing here stores or logs the client secret: it goes to Stripe.js only.
 */
export default function EmbeddedPaymentForm({
  orderId,
  clientSecret,
  onSettled,
}: {
  orderId: string;
  clientSecret: string;
  /** After the script fails, or loads on a retry: the page moves focus to its h1 (§6). */
  onSettled?: () => void;
}) {
  const [script, setScript] = useState<ScriptState>({ status: "loading" });
  const [retrying, setRetrying] = useState(false);
  // Stripe has put its iframe in the slot (announced), and it has a height (the slot's minimum goes).
  const [mounted, setMounted] = useState(false);
  const [sized, setSized] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const attempt = useRef(0);

  const load = useCallback(
    (isRetry: boolean) => {
      const id = ++attempt.current;
      getStripe().then(
        (stripe) => {
          if (id !== attempt.current) return;
          setScript(stripe ? { status: "loaded", stripe } : { status: "failed" });
          setRetrying(false);
          if (!stripe || isRetry) onSettled?.();
        },
        () => {
          if (id !== attempt.current) return;
          setScript({ status: "failed" });
          setRetrying(false);
          onSettled?.();
        },
      );
    },
    [onSettled],
  );

  useEffect(() => {
    load(false);
    return () => {
      attempt.current += 1;
    };
  }, [load]);

  // Stripe draws the form in an iframe it adds to the slot; there's no "ready" callback to use.
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || script.status !== "loaded") return;
    let resize: ResizeObserver | undefined;
    let found = false;
    function check() {
      const frame = found ? null : slot?.querySelector("iframe");
      if (!frame) return;
      found = true;
      observer.disconnect();
      setMounted(true);
      if (typeof ResizeObserver === "undefined") {
        setSized(true);
        return;
      }
      resize = new ResizeObserver(() => {
        if (frame.getBoundingClientRect().height > 0) {
          setSized(true);
          resize?.disconnect();
        }
      });
      resize.observe(frame);
    }
    const observer = new MutationObserver(check);
    observer.observe(slot, { childList: true, subtree: true });
    // Deferred, so the effect body itself never sets state.
    queueMicrotask(check);
    return () => {
      found = true;
      observer.disconnect();
      resize?.disconnect();
    };
  }, [script.status]);

  // Stripe.js only takes the options once (the provider warns on any change).
  const options = useMemo(() => ({ clientSecret }), [clientSecret]);

  return (
    <section aria-labelledby="payment-details" className="flex flex-col">
      <h2 id="payment-details" className="sr-only">
        Payment details
      </h2>
      {/* Stripe's form stays white with a black edge in both themes (§2). No tabIndex, aria-hidden or
          inert here: the iframe keeps its place in the tab order. */}
      <div
        ref={slotRef}
        data-surface="paper"
        data-payment-slot=""
        className={`relative overflow-hidden rounded-card border border-foreground bg-card lg:max-w-xl ${sized ? "" : "min-h-144"}`}
      >
        {script.status === "failed" ? (
          <div className="flex flex-col items-start gap-4 p-5">
            <Notice tone="danger" role="alert">
              The payment form didn&rsquo;t load. Check your connection. If you use a content blocker, allow
              js.stripe.com, then try again. You haven&rsquo;t been charged.
            </Notice>
            <Button
              variant="outline"
              busy={retrying}
              onClick={() => {
                setRetrying(true);
                load(true);
              }}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            {!mounted && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-5">
                <DotsLoader announce label="Loading the payment form" />
              </div>
            )}
            {script.status === "loaded" && (
              <EmbeddedCheckoutProvider key={orderId} stripe={script.stripe} options={options}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            )}
          </>
        )}
      </div>
      {/* Said once, when Stripe's form is in place (it has no ready event of its own). */}
      <p role="status" className="sr-only">
        {mounted ? "Payment form ready" : ""}
      </p>
    </section>
  );
}

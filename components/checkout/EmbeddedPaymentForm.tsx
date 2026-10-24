"use client";

import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import type { Stripe } from "@stripe/stripe-js";
import { useEffect, useMemo, useRef, useState } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { getStripe } from "@/lib/stripe/browser";
import { guardEmbeddedCheckout, type GuardedStripe } from "@/lib/stripe/embedded";

type FormState = { status: "loading" } | { status: "loaded"; stripe: Stripe } | { status: "failed" };

/**
 * How long Stripe.js and its form get to appear (the script, Stripe's setup,
 * and the form drawn with a height) before the page says it didn't load.
 */
export const PAYMENT_FORM_TIMEOUT_MS = 20_000;

/**
 * The white slot holding Stripe's embedded Checkout form
 * (docs/design/checkout-pay.md §5.4). Stripe.js is loaded first, and the
 * provider is mounted only once it has. The provider is given a guarded
 * Stripe (lib/stripe/embedded.ts), so a form Stripe can't set up is reported
 * here rather than left loading. A script that can't load (offline, a content
 * blocker), a setup that fails, or a form that hasn't appeared within
 * PAYMENT_FORM_TIMEOUT_MS all get our own message and a "Try again", which
 * asks the page to load the checkout afresh (it remounts this with a new key).
 *
 * Nothing here stores or logs the client secret: it goes to Stripe.js only.
 */
export default function EmbeddedPaymentForm({
  clientSecret,
  onSettled,
  onRetry,
}: {
  clientSecret: string;
  /** After a failure: the page moves focus to its h1 (§6). */
  onSettled?: () => void;
  /** "Try again": the page asks for the checkout again and mounts a new form. */
  onRetry: () => void;
}) {
  const [form, setForm] = useState<FormState>({ status: "loading" });
  // Stripe's iframe is in the slot with a height: the loader and the slot's minimum go, and it's announced.
  const [ready, setReady] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);
  const stopWatchdog = useRef<() => void>(() => undefined);

  // One attempt per mount: Stripe.js, then a guarded instance for the provider, all within the watchdog.
  useEffect(() => {
    let active = true;
    let guard: GuardedStripe | undefined;
    const fail = () => {
      if (!active) return;
      active = false;
      window.clearTimeout(watchdog);
      guard?.dispose();
      setForm({ status: "failed" });
      settledRef.current?.();
    };
    const watchdog = window.setTimeout(fail, PAYMENT_FORM_TIMEOUT_MS);
    stopWatchdog.current = () => window.clearTimeout(watchdog);
    getStripe().then(
      (stripe) => {
        if (!active) return;
        if (!stripe) {
          fail();
          return;
        }
        guard = guardEmbeddedCheckout(stripe, fail);
        setForm({ status: "loaded", stripe: guard.stripe });
      },
      () => fail(),
    );
    return () => {
      active = false;
      window.clearTimeout(watchdog);
      guard?.dispose();
    };
  }, []);

  // Stripe draws the form in an iframe it adds to the slot; there's no "ready" callback to use. Ready
  // means drawn with a height, not merely inserted.
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot || form.status !== "loaded") return;
    let resize: ResizeObserver | undefined;
    let found = false;
    function markReady() {
      stopWatchdog.current();
      setReady(true);
    }
    function check() {
      const frame = found ? null : slot?.querySelector("iframe");
      if (!frame) return;
      found = true;
      observer.disconnect();
      if (typeof ResizeObserver === "undefined") {
        markReady();
        return;
      }
      resize = new ResizeObserver(() => {
        if (frame.getBoundingClientRect().height > 0) {
          resize?.disconnect();
          markReady();
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
  }, [form.status]);

  // Stripe.js only takes the options once (the provider warns on any change).
  const options = useMemo(() => ({ clientSecret }), [clientSecret]);
  const failed = form.status === "failed";

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
        className={`relative overflow-hidden rounded-card border border-foreground bg-card lg:max-w-xl ${ready || failed ? "" : "min-h-144"}`}
      >
        {failed ? (
          <div className="flex flex-col items-start gap-4 p-5">
            <Notice tone="danger" role="alert">
              The payment form didn&rsquo;t load. Check your connection. If you use a content blocker, allow
              js.stripe.com, then try again. You haven&rsquo;t been charged.
            </Notice>
            <Button variant="outline" className="min-h-11" onClick={onRetry}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {!ready && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-5">
                <DotsLoader announce label="Loading the payment form" />
              </div>
            )}
            {form.status === "loaded" && (
              <EmbeddedCheckoutProvider stripe={form.stripe} options={options}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            )}
          </>
        )}
      </div>
      {/* Said once, when Stripe's form is drawn (it has no ready event of its own). */}
      <p role="status" className="sr-only">
        {ready ? "Payment form ready" : ""}
      </p>
    </section>
  );
}

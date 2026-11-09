"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { getOrderPayment } from "@/lib/api/orders";
import { DETAILS_NOTICE } from "@/lib/buyer-details";
import type { CheckoutClosedReason, OrderPaymentLookup } from "@/lib/api/types";
import { clockOffsetMs, localDeadline } from "@/lib/checkout-countdown";
import {
  CHECKOUT_CLOSED_LABEL,
  CHECKOUT_TIME_UP_TITLE,
  CHECKOUT_UNAVAILABLE_BODY,
  checkoutBackTarget,
  checkoutClosedBody,
  checkoutEndedAction,
  checkoutSoldOutBody,
  checkoutSoldOutLabel,
  checkoutStartAgainTarget,
  checkoutTimeUpBody,
  formatHoldDeadline,
  type CheckoutLinkTarget,
  type CheckoutOrderContext,
} from "@/lib/checkout-pay";
import { preloadStripe } from "@/lib/stripe/browser";
import { isStripeConfigured } from "@/lib/stripe/config";
import CheckoutCountdown from "./CheckoutCountdown";
import EmbeddedPaymentForm from "./EmbeddedPaymentForm";
import OrderPaymentSummary from "./OrderPaymentSummary";
import { ArrowLeftIcon } from "./icons";

type OpenPayment = Extract<OrderPaymentLookup, { status: "open" }>;

type State =
  | { kind: "loading" }
  // `deadline`: the pay deadline on this device's clock (expiresAt allowing for the server's clock).
  | { kind: "open"; payment: OpenPayment; deadline: number }
  // The checkout's time ran out: the server said so (reason time_up), or this page's countdown reached
  // zero first. Then `recheckAt` (this device's clock) is when to ask the server again, to learn whether
  // Stripe took the payment in time (processing: go to the order); null once it has answered.
  | { kind: "time-up"; context: CheckoutOrderContext; recheckAt: number | null }
  // Closed for another reason: `unavailable` has its own words; `ended` (or none) the general ones.
  | { kind: "closed"; context: CheckoutOrderContext; reason?: Exclude<CheckoutClosedReason, "time_up"> }
  | { kind: "sold-out"; context: CheckoutOrderContext }
  | { kind: "redirecting" }
  | { kind: "not-found" }
  | { kind: "not-configured"; context: CheckoutOrderContext }
  | { kind: "not-ready" }
  // 429: asked too often in the last minute (by this connection, or for this order).
  | { kind: "rate-limited" }
  | { kind: "error" };

const PAY_TITLE = "Pay for your tickets";
const SUPPORT_EMAIL = "support@sheltuh.com.au";
/** After the countdown reaches zero, the server is asked again this long after the deadline. */
const RECHECK_AFTER_DEADLINE_MS = 1_000;
/** Never asks again sooner than this: an answer that's still open past its deadline is re-checked at this pace. */
const RECHECK_FLOOR_MS = 5_000;

const linkClass = "text-foreground underline underline-offset-4";
// Focused by script to say the state changed (tabIndex -1); it's not a control, so no focus ring.
// Important (`!`): the global :focus-visible ring in globals.css is unlayered, so it beats any utility otherwise.
const headingClass = "display-md outline-offset-2 focus:outline-none!";

/**
 * /checkout/pay?order={orderId} (docs/design/checkout-pay.md): the order's
 * summary beside Stripe's embedded form. Reads only (GET getOrderPayment);
 * the webhook alone issues tickets. Demo mode and a deploy without a
 * publishable key never load Stripe.js. Otherwise Stripe.js starts loading
 * as the page mounts, beside the first GET, whatever that answers.
 */
export default function CheckoutPayment() {
  const orderId = useSearchParams().get("order");
  if (!isApiConfigured) {
    return (
      <Terminal title="Checkout isn’t available in this demo" action={{ href: "/", label: "Browse events" }}>
        Demo only. Nothing is charged or issued.
      </Terminal>
    );
  }
  if (!orderId) return <NotFound />;
  // A different order is a fresh page: no state carries over.
  return <PaymentFlow key={orderId} orderId={orderId} />;
}

function PaymentFlow({ orderId }: { orderId: string }) {
  const router = useRouter();
  // Read through a ref, so the loader (and the effects that use it) don't depend on the router's identity.
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const [state, setState] = useState<State>({ kind: "loading" });
  // The last order context seen, so a later error still knows where "back" is.
  const [context, setContext] = useState<CheckoutOrderContext | undefined>(undefined);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const request = useRef(0);
  const settledOnce = useRef(false);
  // Set once this page's countdown has reached zero (or an open answer came already past its deadline):
  // from then on Stripe's form is never mounted again, whatever a late answer says.
  const timedOut = useRef(false);
  // The polite live region's words: only the countdown's 5:00, 1:00 and time's up (never the ticking text).
  const [announcement, setAnnouncement] = useState("");
  // Bumped by the payment form's "Try again", so a fresh form (and Stripe instance) is mounted.
  const [formKey, setFormKey] = useState(0);

  const load = useCallback(
    async (showLoading: boolean) => {
      const id = ++request.current;
      if (showLoading) setState({ kind: "loading" });
      try {
        const result = await getOrderPayment(orderId);
        if (id !== request.current) return;
        if (result.status === "processing" || result.status === "done") {
          setState({ kind: "redirecting" });
          routerRef.current.replace(`/checkout/success?session_id=${encodeURIComponent(orderId)}`);
          return;
        }
        const next: CheckoutOrderContext = { eventSlug: result.eventSlug, seated: result.seated };
        setContext(next);
        if (timedOut.current) {
          // Time's up already shown: it stays. Still open by the server's clock (a slow answer): ask again
          // once that's passed too, never sooner than RECHECK_FLOOR_MS. Otherwise nothing more to ask.
          const recheckAt =
            result.status === "open"
              ? Date.now() + Math.max(msLeft(result) + RECHECK_AFTER_DEADLINE_MS || 0, RECHECK_FLOOR_MS)
              : null;
          setState({ kind: "time-up", context: next, recheckAt });
          return;
        }
        if (result.status === "open") {
          if (!isStripeConfigured) {
            setState({ kind: "not-configured", context: next });
            return;
          }
          const deadline = localDeadline(result.expiresAt, clockOffsetMs(result.serverTime, Date.now()));
          if (deadline > Date.now()) {
            setState({ kind: "open", payment: result, deadline });
          } else {
            // Open, but already past its deadline (an answer that took a while), or with none that can be
            // read: no form, and ask again.
            timedOut.current = true;
            setState({ kind: "time-up", context: next, recheckAt: Date.now() + RECHECK_FLOOR_MS });
          }
        } else if (result.status === "sold_out") {
          setState({ kind: "sold-out", context: next });
        } else if (result.reason === "time_up") {
          timedOut.current = true;
          setState({ kind: "time-up", context: next, recheckAt: null });
        } else {
          setState({ kind: "closed", context: next, reason: result.reason });
        }
      } catch (err) {
        if (id !== request.current) return;
        // Time's up already shown: it stays (the server closes the checkout anyway, at the latest within
        // its sweeper's 2 minutes). Nothing to retry from there.
        if (timedOut.current) return;
        if (err instanceof ApiError && err.status === 404) setState({ kind: "not-found" });
        else if (err instanceof ApiError && err.status === 409) setState({ kind: "not-ready" });
        else if (err instanceof ApiError && err.status === 429) setState({ kind: "rate-limited" });
        else setState({ kind: "error" });
      }
    },
    [orderId],
  );

  // Stripe.js loads while the order is asked for, not after (the form's own getStripe() shares this load).
  // Only Stripe's form is created from it, and only for an open checkout.
  useEffect(() => {
    if (isStripeConfigured) preloadStripe();
  }, []);

  // First load, and again when the page comes back from the back/forward cache (it may have been
  // paid, or have closed, meanwhile).
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (!disposed) void load(false);
    });
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) void load(false);
    }
    window.addEventListener("pageshow", onPageShow);
    return () => {
      disposed = true;
      request.current += 1;
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [load]);

  // The countdown reached zero (it reads the clock afresh each tick and when the page is shown again):
  // the time's-up panel replaces the form at once, and the server is asked again just after the deadline
  // (it closes the checkout for good then; or Stripe took the payment in time, and it's the order).
  const timeUp = useCallback(() => {
    timedOut.current = true;
    setState((current) =>
      current.kind === "open"
        ? {
            kind: "time-up",
            context: { eventSlug: current.payment.eventSlug, seated: current.payment.seated },
            recheckAt: current.deadline + RECHECK_AFTER_DEADLINE_MS,
          }
        : current,
    );
  }, []);

  const recheckAt = state.kind === "time-up" ? state.recheckAt : null;
  useEffect(() => {
    if (recheckAt === null) return;
    const timer = window.setTimeout(() => void load(false), Math.max(recheckAt - Date.now(), 0));
    return () => window.clearTimeout(timer);
  }, [recheckAt, load]);

  // Focus follows a change of state, but not the first answer: on arrival, Next's route announcer has it
  // (§6). Except time's up and unavailable, which end the page whenever they come: their h1 is focused.
  const endsPage = state.kind === "time-up" || (state.kind === "closed" && state.reason === "unavailable");
  useEffect(() => {
    if (state.kind === "loading" || state.kind === "redirecting") return;
    if (settledOnce.current || endsPage) headingRef.current?.focus();
    settledOnce.current = true;
  }, [state.kind, endsPage]);

  const focusHeading = useCallback(() => headingRef.current?.focus(), []);
  const back = checkoutBackTarget(state.kind === "open" ? state.payment : context);
  const retry = () => void load(true);
  const retryForm = useCallback(() => {
    setFormKey((key) => key + 1);
    void load(true);
  }, [load]);

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const view: ReactNode = (() => {
    switch (state.kind) {
      case "loading":
        return <CheckoutPaymentLoading />;
      case "redirecting":
        return (
          <div className="pt-6 pb-16 sm:pt-8 lg:pt-12">
            <DotsLoader announce label="Taking you to your order" />
          </div>
        );
      case "not-found":
        return <NotFound headingRef={headingRef} />;
      case "not-configured": {
        const target = checkoutBackTarget(state.context);
        return (
          <Terminal headingRef={headingRef} title="Card payments aren’t available right now" action={target}>
            You haven&rsquo;t been charged. Try again later, or email{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
              {SUPPORT_EMAIL}
            </a>
            .
          </Terminal>
        );
      }
      case "time-up":
        // Back to the event's tickets to start again. Stripe's form went with the open state.
        return (
          <Terminal headingRef={headingRef} title={CHECKOUT_TIME_UP_TITLE} action={checkoutStartAgainTarget(state.context)}>
            {checkoutTimeUpBody(state.context.seated)}
          </Terminal>
        );
      case "closed": {
        // The event's page either way (seated or not): it says whether it can be booked.
        const target = checkoutEndedAction({ ...state.context, seated: false }, CHECKOUT_CLOSED_LABEL);
        return (
          <Terminal headingRef={headingRef} title="This checkout has closed" action={target}>
            {state.reason === "unavailable" ? CHECKOUT_UNAVAILABLE_BODY : checkoutClosedBody(state.context.seated)}
          </Terminal>
        );
      }
      case "sold-out": {
        const { seated } = state.context;
        return (
          <Terminal
            headingRef={headingRef}
            title="These tickets have just sold out"
            action={checkoutEndedAction(state.context, checkoutSoldOutLabel(seated))}
          >
            {checkoutSoldOutBody(seated)}
          </Terminal>
        );
      }
      case "not-ready":
      case "rate-limited":
      case "error":
        return (
          <div className="pt-6 pb-16 sm:pt-8 lg:pt-12">
            <PayHeader back={back} headingRef={headingRef} />
            <div className="mt-6 flex max-w-2xl flex-col items-start gap-4">
              <Notice tone="danger" role="alert">
                {state.kind === "not-ready"
                  ? "This checkout is still being set up."
                  : state.kind === "rate-limited"
                    ? "Too many tries — wait a minute, then try again. You haven’t been charged."
                    : "Couldn’t load checkout right now. You haven’t been charged."}
              </Notice>
              <Button variant="outline" className="min-h-11" onClick={retry}>
                Try again
              </Button>
            </div>
          </div>
        );
      case "open": {
        const { payment } = state;
        return (
          <PayLayout
            header={<PayHeader back={back} headingRef={headingRef} />}
            summary={<OrderPaymentSummary summary={payment} />}
            hold={
              payment.seated ? (
                <p className="text-xs text-muted">
                  Your seats are held until {formatHoldDeadline(payment.expiresAt, payment.eventTimeZone, payment.eventState)}. Going back releases them.
                </p>
              ) : null
            }
            form={
              <>
                <CheckoutCountdown deadline={state.deadline} onTimeUp={timeUp} onAnnounce={announce} />
                <p className="mb-4 text-xs text-muted lg:max-w-xl">{DETAILS_NOTICE}</p>
                <EmbeddedPaymentForm
                  key={formKey}
                  clientSecret={payment.clientSecret}
                  onSettled={focusHeading}
                  onRetry={retryForm}
                />
                <LegalLine />
              </>
            }
          />
        );
      }
    }
  })();

  return (
    <>
      {view}
      {/* Polite, and only the countdown's 5:00, 1:00 and time's up: outside every state, so it's still
          there when the time's-up panel replaces the form. Not role="status" (the loaders have that). */}
      <p aria-live="polite" aria-atomic="true" className="sr-only" data-countdown-announcer>
        {announcement}
      </p>
    </>
  );
}

/** Time left by the server's clock in an open answer, read as it arrives (ms; NaN for an unreadable expiresAt). */
function msLeft(payment: OpenPayment): number {
  const now = Date.now();
  return localDeadline(payment.expiresAt, clockOffsetMs(payment.serverTime, now)) - now;
}

/** The page's grid (§3): header full width; below lg one column, from lg summary 5 / form 7. */
function PayLayout({ header, summary, hold, form }: { header: ReactNode; summary: ReactNode; hold?: ReactNode; form: ReactNode }) {
  return (
    <div className="pt-6 pb-16 sm:pt-8 lg:pt-12">
      {header}
      <div className="mt-6 flex max-w-2xl flex-col gap-6 lg:mt-8 lg:grid lg:max-w-none lg:grid-cols-12 lg:items-start lg:gap-12">
        <div className="flex flex-col gap-6 lg:sticky lg:top-24 lg:col-span-5">
          {summary}
          {hold}
        </div>
        <div className="flex min-w-0 flex-col lg:col-span-7">{form}</div>
      </div>
    </div>
  );
}

/** Back link and the h1. */
function PayHeader({
  back,
  headingRef,
}: {
  back?: CheckoutLinkTarget;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      {back ? (
        <Link href={back.href} className="inline-flex min-h-11 w-fit items-center gap-2 text-sm text-foreground underline underline-offset-4">
          <ArrowLeftIcon />
          {back.label}
        </Link>
      ) : (
        <div aria-hidden="true" className="min-h-11" />
      )}
      <h1 ref={headingRef} tabIndex={-1} className={headingClass}>
        {PAY_TITLE}
      </h1>
    </div>
  );
}

function LegalLine() {
  return (
    <p className="mt-4 text-xs text-muted lg:max-w-xl">
      By paying you agree to the{" "}
      <Link href="/purchase-terms" className={`${linkClass} py-1 whitespace-nowrap`}>
        Purchase Terms
      </Link>
      . See our{" "}
      <Link href="/privacy" className={`${linkClass} py-1 whitespace-nowrap`}>
        Privacy Policy
      </Link>
      . Card details go to Stripe, not Sheltüh.
    </p>
  );
}

/** The loading state (also the page's Suspense fallback): the layout, a summary skeleton and the loader in the slot. */
export function CheckoutPaymentLoading() {
  return (
    <PayLayout
      header={<PayHeader />}
      summary={
        <div aria-hidden="true" className="flex flex-col gap-4 rounded-card border border-foreground bg-card p-4 sm:p-5">
          <div className="h-6 w-3/4 rounded-badge bg-surface" />
          <div className="flex flex-col gap-2">
            <div className="h-4 w-1/2 rounded-badge bg-surface" />
            <div className="h-4 w-2/3 rounded-badge bg-surface" />
          </div>
          <div className="h-7 w-full rounded-badge bg-surface" />
        </div>
      }
      form={
        <div
          data-surface="paper"
          className="flex min-h-144 items-center justify-center rounded-card border border-foreground bg-card p-5 lg:max-w-xl"
        >
          <DotsLoader announce label="Loading checkout" />
        </div>
      }
    />
  );
}

function NotFound({ headingRef }: { headingRef?: Ref<HTMLHeadingElement> }) {
  return (
    <Terminal headingRef={headingRef} title="We couldn’t find that checkout" action={{ href: "/", label: "Back to Sheltüh" }}>
      If you were charged, your tickets are on their way.
    </Terminal>
  );
}

/** A state that ends the page (§5.2): no steps or summary, its own h1, why, and one way out. */
function Terminal({
  title,
  children,
  action,
  headingRef,
}: {
  title: string;
  children: ReactNode;
  action: CheckoutLinkTarget;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  return (
    <div className="pt-6 pb-16 sm:pt-8 lg:pt-12">
      <div className="flex max-w-2xl flex-col items-start gap-3">
        <h1 ref={headingRef} tabIndex={-1} className={`${headingClass} text-balance`}>
          {title}
        </h1>
        <p className="max-w-md text-sm text-muted">{children}</p>
        <ButtonLink variant="solid" size="lg" href={action.href} className="mt-3 w-full sm:w-auto">
          {action.label}
        </ButtonLink>
      </div>
    </div>
  );
}

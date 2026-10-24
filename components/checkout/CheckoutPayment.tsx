"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { DotsLoader } from "@/components/brand/DotsMark";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Section";
import { ApiError, isApiConfigured } from "@/lib/api/client";
import { getOrderPayment } from "@/lib/api/orders";
import type { OrderPaymentLookup } from "@/lib/api/types";
import {
  CHECKOUT_CLOSED_LABEL,
  checkoutBackTarget,
  checkoutClosedBody,
  checkoutEndedAction,
  checkoutSoldOutBody,
  checkoutSoldOutLabel,
  type CheckoutLinkTarget,
  type CheckoutOrderContext,
} from "@/lib/checkout-pay";
import { formatEventTime } from "@/lib/format";
import { isStripeConfigured } from "@/lib/stripe/config";
import EmbeddedPaymentForm from "./EmbeddedPaymentForm";
import OrderPaymentSummary from "./OrderPaymentSummary";
import { ArrowLeftIcon } from "./icons";

type OpenPayment = Extract<OrderPaymentLookup, { status: "open" }>;

type State =
  | { kind: "loading" }
  | { kind: "open"; payment: OpenPayment }
  | { kind: "closed"; context: CheckoutOrderContext }
  | { kind: "sold-out"; context: CheckoutOrderContext }
  | { kind: "redirecting" }
  | { kind: "not-found" }
  | { kind: "not-configured"; context?: CheckoutOrderContext }
  | { kind: "not-ready" }
  | { kind: "error" };

const PAY_TITLE = "Pay for your tickets";
const SUPPORT_EMAIL = "support@sheltuh.com.au";
/** setTimeout's longest delay (about 24.8 days); a later expiry is re-checked then. */
const MAX_TIMER_MS = 2_147_483_647;

const linkClass = "text-foreground underline underline-offset-4";
const headingClass = "display-md outline-offset-2";

/**
 * /checkout/pay?order={orderId} (docs/design/checkout-pay.md): the order's
 * summary beside Stripe's embedded form. Reads only (GET getOrderPayment);
 * the webhook alone issues tickets. Demo mode and a deploy without a
 * publishable key never load Stripe.js.
 */
export default function CheckoutPayment() {
  const orderId = useSearchParams().get("order");
  if (!isApiConfigured) {
    return (
      <Terminal title="Checkout isn’t available in this demo" action={{ href: "/", label: "Browse events" }}>
        This is a local prototype. No payment information is collected and no tickets are issued.
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
        if (result.status === "open") {
          setState(isStripeConfigured ? { kind: "open", payment: result } : { kind: "not-configured", context: next });
        } else {
          setState({ kind: result.status === "closed" ? "closed" : "sold-out", context: next });
        }
      } catch (err) {
        if (id !== request.current) return;
        if (err instanceof ApiError && err.status === 404) setState({ kind: "not-found" });
        else if (err instanceof ApiError && err.status === 409) setState({ kind: "not-ready" });
        else if (err instanceof ApiError && err.status === 503) setState({ kind: "not-configured" });
        else setState({ kind: "error" });
      }
    },
    [orderId],
  );

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

  // Once the checkout's time is up, ask again: the answer will be that it has closed. No countdown
  // on screen (WCAG 2.2.1).
  const expiresAt = state.kind === "open" ? state.payment.expiresAt : null;
  useEffect(() => {
    if (!expiresAt) return;
    const delay = Math.min(Math.max(Date.parse(expiresAt) - Date.now() + 1000, 0), MAX_TIMER_MS);
    const timer = window.setTimeout(() => void load(false), delay);
    return () => window.clearTimeout(timer);
  }, [expiresAt, load]);

  // Focus follows a change of state, but not the first answer: on arrival, Next's route announcer has it (§6).
  useEffect(() => {
    if (state.kind === "loading" || state.kind === "redirecting") return;
    if (settledOnce.current) headingRef.current?.focus();
    settledOnce.current = true;
  }, [state.kind]);

  const focusHeading = useCallback(() => headingRef.current?.focus(), []);
  const back = checkoutBackTarget(state.kind === "open" ? state.payment : context);
  const retry = () => void load(true);

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
      const target = checkoutBackTarget(state.context ?? context);
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
    case "closed": {
      // The event's page either way (its time ran out, or the event can't be booked right now): it says which.
      const target = checkoutEndedAction({ ...state.context, seated: false }, CHECKOUT_CLOSED_LABEL);
      return (
        <Terminal headingRef={headingRef} title="This checkout has closed" action={target}>
          {checkoutClosedBody(state.context.seated)}
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
    case "error":
      return (
        <div className="pt-6 pb-16 sm:pt-8 lg:pt-12">
          <PayHeader back={back} seated={context?.seated} headingRef={headingRef} />
          <div className="mt-6 flex max-w-2xl flex-col items-start gap-4">
            <Notice tone="danger" role="alert">
              {state.kind === "not-ready"
                ? "This checkout is still being set up."
                : "Couldn’t load checkout right now. You haven’t been charged."}
            </Notice>
            <Button variant="outline" onClick={retry}>
              Try again
            </Button>
          </div>
        </div>
      );
    case "open": {
      const { payment } = state;
      return (
        <PayLayout
          header={<PayHeader back={back} seated={payment.seated} headingRef={headingRef} />}
          summary={<OrderPaymentSummary summary={payment} />}
          hold={
            payment.seated ? (
              <p className="text-xs text-muted">
                Your seats are held until {formatEventTime(payment.expiresAt)}. Going back releases them.
              </p>
            ) : null
          }
          form={
            <>
              <EmbeddedPaymentForm orderId={orderId} clientSecret={payment.clientSecret} onSettled={focusHeading} />
              <LegalLine />
            </>
          }
        />
      );
    }
  }
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

/** Back link, steps and the h1. Unknown order (still loading): space held for the first two. */
function PayHeader({
  back,
  seated,
  headingRef,
}: {
  back?: CheckoutLinkTarget;
  seated?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const steps = [seated ? "Choose seats" : "Choose tickets", "Pay", "Tickets by email"];
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
      {seated === undefined ? (
        <div aria-hidden="true" className="h-4" />
      ) : (
        <ol aria-label="Checkout steps" className="eyebrow flex flex-wrap gap-x-3 gap-y-1">
          {steps.map((step, i) => (
            <li
              key={step}
              aria-current={i === 1 ? "step" : undefined}
              className={`flex gap-x-3 ${i === 1 ? "text-foreground" : "text-muted"}`}
            >
              {i > 0 && <span aria-hidden="true">&rarr;</span>}
              <span>
                {i + 1} {step}
              </span>
            </li>
          ))}
        </ol>
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
      <Link href="/purchase-terms" className={`${linkClass} py-1`}>
        Purchase Terms
      </Link>
      . See our{" "}
      <Link href="/privacy" className={`${linkClass} py-1`}>
        Privacy Policy
      </Link>
      . Card details go straight to Stripe, our payment provider, and never reach Sheltüh.
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
      The link may be incomplete. If you were charged, your tickets are on their way to your email.
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
        <h1 ref={headingRef} tabIndex={-1} className={headingClass}>
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

/**
 * Stripe.js, as handed to @stripe/react-stripe-js's EmbeddedCheckoutProvider
 * on the payment page (components/checkout/EmbeddedPaymentForm.tsx).
 *
 * The provider calls `stripe.createEmbeddedCheckoutPage(options)` once and
 * ignores a rejection, which would leave the page loading for ever (and log
 * an unhandled rejection). It also never destroys an instance that arrives
 * after it has unmounted. So it gets a stand-in whose prototype is the real
 * Stripe object (everything the provider checks for, `elements`,
 * `createToken`, `createPaymentMethod`, `confirmCardPayment`, is inherited)
 * with only `createEmbeddedCheckoutPage` replaced:
 *
 * - a failure is reported to `onError` and the provider's promise never
 *   settles (no unhandled rejection; the page shows its own message);
 * - Stripe.js allows one embedded Checkout at a time, so any earlier one on
 *   the page is destroyed first, and a create waits for the one before it
 *   (or for that one's guard to be disposed, so a create that hangs can't
 *   hold up "Try again");
 * - once disposed (the form unmounted, failed or timed out), a create that
 *   was still in flight has its instance destroyed as it arrives.
 *
 * Nothing here stores or logs the options: the client secret goes to Stripe.js only.
 */
import type { Stripe, StripeEmbeddedCheckout, StripeEmbeddedCheckoutOptions } from "@stripe/stripe-js";

/** Settles once the page's latest create has, whatever its outcome. */
let previousCreate: Promise<void> = Promise.resolve();
/** The page's embedded Checkout, until it's destroyed. */
let live: StripeEmbeddedCheckout | null = null;

export interface GuardedStripe {
  /** For EmbeddedCheckoutProvider's `stripe` prop. */
  stripe: Stripe;
  /** Destroys this guard's embedded Checkout (now, or as it arrives) and stops reporting errors. */
  dispose: () => void;
}

function never<T>(): Promise<T> {
  return new Promise<T>(() => undefined);
}

export function guardEmbeddedCheckout(stripe: Stripe, onError: (error: unknown) => void): GuardedStripe {
  let disposed = false;
  let own: StripeEmbeddedCheckout | null = null;
  let signalDisposed: () => void = () => undefined;
  const disposal = new Promise<void>((resolve) => {
    signalDisposed = resolve;
  });

  /** Destroy is idempotent (the provider and dispose may both call it), and unmount is a no-op after it. */
  function track(instance: StripeEmbeddedCheckout): StripeEmbeddedCheckout {
    let destroyed = false;
    const tracked: StripeEmbeddedCheckout = {
      mount: (location) => instance.mount(location),
      unmount: () => {
        if (!destroyed) instance.unmount();
      },
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        if (live === tracked) live = null;
        if (own === tracked) own = null;
        instance.destroy();
      },
    };
    return tracked;
  }

  function createEmbeddedCheckoutPage(options: StripeEmbeddedCheckoutOptions): Promise<StripeEmbeddedCheckout> {
    const created = previousCreate.then(async () => {
      live?.destroy();
      if (disposed) return null;
      const instance = track(await stripe.createEmbeddedCheckoutPage(options));
      if (disposed) {
        // Late (the form gave up, or a newer one may be live): gone at once, never the page's live one.
        instance.destroy();
        return null;
      }
      live = instance;
      own = instance;
      return instance;
    });
    previousCreate = Promise.race([
      created.then(
        () => undefined,
        () => undefined,
      ),
      disposal,
    ]);
    return created.then(
      (instance) => instance ?? never<StripeEmbeddedCheckout>(),
      (error: unknown) => {
        if (!disposed) onError(error);
        return never<StripeEmbeddedCheckout>();
      },
    );
  }

  // A property descriptor, not an assignment: it works even if Stripe's own method isn't writable.
  const guarded: Stripe = Object.create(stripe, {
    createEmbeddedCheckoutPage: { value: createEmbeddedCheckoutPage, enumerable: true },
  });

  return {
    stripe: guarded,
    dispose: () => {
      disposed = true;
      signalDisposed();
      own?.destroy();
    },
  };
}

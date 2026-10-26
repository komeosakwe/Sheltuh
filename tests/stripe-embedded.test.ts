import type { Stripe, StripeEmbeddedCheckout } from "@stripe/stripe-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/stripe/embedded.ts: the Stripe that @stripe/react-stripe-js's
 * EmbeddedCheckoutProvider is given on the payment page. Stripe.js is faked.
 */

type Guard = typeof import("@/lib/stripe/embedded");
let guardEmbeddedCheckout: Guard["guardEmbeddedCheckout"];

beforeEach(async () => {
  // The module keeps the page's one live form: a fresh page per test.
  vi.resetModules();
  ({ guardEmbeddedCheckout } = await import("@/lib/stripe/embedded"));
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeInstance(log: string[], name: string) {
  return {
    mount: vi.fn(() => log.push(`mount ${name}`)),
    unmount: vi.fn(() => log.push(`unmount ${name}`)),
    destroy: vi.fn(() => log.push(`destroy ${name}`)),
  } satisfies StripeEmbeddedCheckout;
}

/** A Stripe whose methods live on its prototype, as a class instance's would. */
function fakeStripe(create: () => Promise<StripeEmbeddedCheckout>) {
  const proto = {
    elements: vi.fn(),
    createToken: vi.fn(),
    createPaymentMethod: vi.fn(),
    confirmCardPayment: vi.fn(),
    createEmbeddedCheckoutPage: vi.fn(create),
  };
  const stripe = Object.create(proto) as typeof proto;
  return { stripe, asStripe: stripe as unknown as Stripe, create: proto.createEmbeddedCheckoutPage };
}

/** Lets every pending promise callback run. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe("guardEmbeddedCheckout", () => {
  it("passes the provider's checks (inherited), and creates through the real Stripe with the same options", async () => {
    const log: string[] = [];
    const instance = fakeInstance(log, "A");
    const { asStripe, create } = fakeStripe(() => Promise.resolve(instance));
    const { stripe } = guardEmbeddedCheckout(asStripe, vi.fn());
    // What @stripe/react-stripe-js's isStripe() looks for.
    expect(typeof stripe.elements).toBe("function");
    expect(typeof stripe.createToken).toBe("function");
    expect(typeof stripe.createPaymentMethod).toBe("function");
    expect(typeof stripe.confirmCardPayment).toBe("function");
    expect(Object.getPrototypeOf(stripe)).toBe(asStripe);

    const options = { clientSecret: "cs_test_1" };
    const created = await stripe.createEmbeddedCheckoutPage(options);
    expect(create).toHaveBeenCalledWith(options);
    const target = { id: "slot" } as unknown as HTMLElement;
    created.mount(target);
    expect(instance.mount).toHaveBeenCalledWith(target);
    // Destroy is passed on once, however often it's called; unmount after it is a no-op.
    created.destroy();
    created.destroy();
    created.unmount();
    expect(log).toEqual(["mount A", "destroy A"]);
  });

  it("a rejected create is reported, and the provider's promise never settles (no unhandled rejection)", async () => {
    const error = new Error("No such checkout session");
    const onError = vi.fn();
    const { asStripe } = fakeStripe(() => Promise.reject(error));
    const { stripe } = guardEmbeddedCheckout(asStripe, onError);
    const settled = vi.fn();
    stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" }).then(settled, settled);
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect(settled).not.toHaveBeenCalled();
  });

  it("a create that throws synchronously is reported the same way", async () => {
    const onError = vi.fn();
    const { asStripe } = fakeStripe(() => {
      throw new Error("IntegrationError");
    });
    const { stripe } = guardEmbeddedCheckout(asStripe, onError);
    void stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    await settle();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("a failure after dispose isn't reported (the page has already moved on)", async () => {
    const pending = deferred<StripeEmbeddedCheckout>();
    const onError = vi.fn();
    const { asStripe } = fakeStripe(() => pending.promise);
    const guard = guardEmbeddedCheckout(asStripe, onError);
    void guard.stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    await settle();
    guard.dispose();
    pending.reject(new Error("late"));
    await settle();
    expect(onError).not.toHaveBeenCalled();
  });

  it("an instance that arrives after dispose is destroyed straight away and never handed over", async () => {
    const log: string[] = [];
    const pending = deferred<StripeEmbeddedCheckout>();
    const { asStripe } = fakeStripe(() => pending.promise);
    const guard = guardEmbeddedCheckout(asStripe, vi.fn());
    const settled = vi.fn();
    guard.stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" }).then(settled, settled);
    await settle();
    guard.dispose();
    pending.resolve(fakeInstance(log, "A"));
    await settle();
    expect(log).toEqual(["destroy A"]);
    expect(settled).not.toHaveBeenCalled();
  });

  it("dispose destroys this guard's form", async () => {
    const log: string[] = [];
    const { asStripe } = fakeStripe(() => Promise.resolve(fakeInstance(log, "A")));
    const guard = guardEmbeddedCheckout(asStripe, vi.fn());
    await guard.stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    guard.dispose();
    guard.dispose();
    expect(log).toEqual(["destroy A"]);
  });

  it("one form at a time: a new create destroys the page's earlier form first, even one nobody destroyed", async () => {
    const log: string[] = [];
    let n = 0;
    const { asStripe, create } = fakeStripe(() => {
      n += 1;
      log.push(`create ${n}`);
      return Promise.resolve(fakeInstance(log, String(n)));
    });
    // The first guard's form is left in place (as the provider's cleanup can, for a late instance).
    await guardEmbeddedCheckout(asStripe, vi.fn()).stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    await guardEmbeddedCheckout(asStripe, vi.fn()).stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    expect(log).toEqual(["create 1", "destroy 1", "create 2"]);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("a create waits for the one before it, then destroys what it made", async () => {
    const log: string[] = [];
    const first = deferred<StripeEmbeddedCheckout>();
    let n = 0;
    const { asStripe } = fakeStripe(() => {
      n += 1;
      log.push(`create ${n}`);
      return n === 1 ? first.promise : Promise.resolve(fakeInstance(log, String(n)));
    });
    const one = guardEmbeddedCheckout(asStripe, vi.fn());
    void one.stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    await settle();
    const second = guardEmbeddedCheckout(asStripe, vi.fn()).stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    await settle();
    expect(log).toEqual(["create 1"]);
    first.resolve(fakeInstance(log, "1"));
    await second;
    expect(log).toEqual(["create 1", "destroy 1", "create 2"]);
  });

  it("a create that hangs doesn't hold up the next once its guard is disposed (Try again after the timeout)", async () => {
    const log: string[] = [];
    const hung = deferred<StripeEmbeddedCheckout>();
    let n = 0;
    const { asStripe } = fakeStripe(() => {
      n += 1;
      log.push(`create ${n}`);
      return n === 1 ? hung.promise : Promise.resolve(fakeInstance(log, String(n)));
    });
    const one = guardEmbeddedCheckout(asStripe, vi.fn());
    void one.stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    await settle();
    one.dispose();
    const two = await guardEmbeddedCheckout(asStripe, vi.fn()).stripe.createEmbeddedCheckoutPage({ clientSecret: "cs_test_1" });
    expect(log).toEqual(["create 1", "create 2"]);
    // The hung one turning up late is destroyed; the new one stays.
    hung.resolve(fakeInstance(log, "1"));
    await settle();
    expect(log).toEqual(["create 1", "create 2", "destroy 1"]);
    two.destroy();
    expect(log.at(-1)).toBe("destroy 2");
  });
});

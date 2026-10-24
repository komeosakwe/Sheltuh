import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/stripe/browser.ts: the payment page's one Stripe.js load. The payment
 * page starts it early (preloadStripe) and the form asks for it later
 * (getStripe); both must share one load, and a failed load mustn't be kept.
 * @stripe/stripe-js is faked, so nothing loads https://js.stripe.com.
 */

const key = vi.hoisted(() => ({ value: "pk_test_unit" as string | undefined }));
const loadStripe = vi.fn();

vi.mock("@stripe/stripe-js/pure", () => ({ loadStripe: (...args: unknown[]) => loadStripe(...args) }));
vi.mock("@/lib/stripe/config", () => ({
  get STRIPE_PUBLISHABLE_KEY() {
    return key.value;
  },
  get isStripeConfigured() {
    return Boolean(key.value);
  },
}));

const STRIPE = { createEmbeddedCheckoutPage: vi.fn() };

/** A fresh module each time, so its memoised load starts empty. */
async function browser() {
  vi.resetModules();
  return import("@/lib/stripe/browser");
}

/** A load the test settles itself. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (err: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  key.value = "pk_test_unit";
});

afterEach(() => {
  loadStripe.mockReset();
});

describe("preloadStripe and getStripe", () => {
  it("share one load: the form's getStripe() gets the instance the preload started", async () => {
    const load = deferred<typeof STRIPE>();
    loadStripe.mockReturnValue(load.promise);
    const { preloadStripe, getStripe } = await browser();

    preloadStripe();
    expect(loadStripe).toHaveBeenCalledTimes(1);
    expect(loadStripe).toHaveBeenCalledWith("pk_test_unit");
    // Asked while still loading: the same load, not a second script.
    const asked = getStripe();
    expect(loadStripe).toHaveBeenCalledTimes(1);
    load.resolve(STRIPE);
    await expect(asked).resolves.toBe(STRIPE);
    // And after it has loaded.
    await expect(getStripe()).resolves.toBe(STRIPE);
    preloadStripe();
    expect(loadStripe).toHaveBeenCalledTimes(1);
  });

  it("a failed preload is swallowed (no unhandled rejection), and the next getStripe() loads again", async () => {
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      loadStripe.mockRejectedValueOnce(new Error("Failed to load Stripe.js")).mockResolvedValueOnce(STRIPE);
      const { preloadStripe, getStripe } = await browser();

      preloadStripe();
      // Let the rejection settle (and any unhandled-rejection report fire).
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).not.toHaveBeenCalled();

      await expect(getStripe()).resolves.toBe(STRIPE);
      expect(loadStripe).toHaveBeenCalledTimes(2);
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("a form asking while the preload is failing gets the failure (its own alert), then Try again loads afresh", async () => {
    const first = deferred<typeof STRIPE>();
    loadStripe.mockReturnValueOnce(first.promise).mockResolvedValueOnce(STRIPE);
    const { preloadStripe, getStripe } = await browser();

    preloadStripe();
    const asked = getStripe();
    first.reject(new Error("Failed to load Stripe.js"));
    await expect(asked).rejects.toThrow("Failed to load Stripe.js");
    await expect(getStripe()).resolves.toBe(STRIPE);
    expect(loadStripe).toHaveBeenCalledTimes(2);
  });

  it("a load that resolves to nothing isn't kept either", async () => {
    loadStripe.mockResolvedValueOnce(null).mockResolvedValueOnce(STRIPE);
    const { preloadStripe, getStripe } = await browser();

    preloadStripe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(getStripe()).resolves.toBe(STRIPE);
    expect(loadStripe).toHaveBeenCalledTimes(2);
  });

  it("without a publishable key: nothing loads, and getStripe() resolves to null", async () => {
    key.value = undefined;
    const { preloadStripe, getStripe } = await browser();

    preloadStripe();
    await expect(getStripe()).resolves.toBeNull();
    expect(loadStripe).not.toHaveBeenCalled();
  });
});

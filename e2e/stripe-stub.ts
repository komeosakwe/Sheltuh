import type { Page } from "@playwright/test";

/**
 * What each `createEmbeddedCheckoutPage` call does, in order (the last one
 * repeats): mount the form at once ("mount"), reject as Stripe.js does when
 * it can't set the form up ("reject"), never answer ("hang"), or mount an
 * iframe that has no height until `sizeDelayMs` later ("delayed-size", as
 * Stripe's form is inserted before it's drawn).
 */
export type StripeCreateMode = "mount" | "reject" | "hang" | "delayed-size";

export interface StripeStubOptions {
  modes?: StripeCreateMode[];
  /** For "delayed-size": how long the iframe stays 0 high. */
  sizeDelayMs?: number;
}

/**
 * Stripe.js, stubbed: every request to https://js.stripe.com is answered with
 * a script that defines `window.Stripe` (release train "endive", as
 * @stripe/stripe-js expects) whose `createEmbeddedCheckoutPage` records the
 * publishable key and client secret it was given and mounts a plain iframe
 * where Stripe's form would be. Like Stripe.js, it refuses a second embedded
 * Checkout while one exists (not destroyed). Nothing reaches Stripe. It
 * proves our page hands Stripe.js the right secret, mounts the form, and
 * copes when it fails; it says nothing about the real form's behaviour
 * (declines, 3DS, wallets).
 */
function stubSource({ modes = ["mount"], sizeDelayMs = 1500 }: StripeStubOptions): string {
  return `(() => {
  const modes = ${JSON.stringify(modes)};
  const sizeDelayMs = ${JSON.stringify(sizeDelayMs)};
  const seen = (window.__stripeE2E = { keys: [], secrets: [], destroyed: 0 });
  let calls = 0;
  let live = null;
  function Stripe(key) {
    seen.keys.push(key);
    const unused = () => Promise.reject(new Error("not stubbed in e2e"));
    return {
      // What @stripe/react-stripe-js checks a Stripe object has (its provider throws otherwise).
      elements: () => ({}),
      createToken: unused,
      createPaymentMethod: unused,
      confirmCardPayment: unused,
      createEmbeddedCheckoutPage(options) {
        const mode = modes[Math.min(calls, modes.length - 1)];
        calls += 1;
        seen.secrets.push(options.clientSecret);
        if (live) return Promise.reject(new Error("You cannot have multiple Embedded Checkout objects."));
        if (mode === "reject") return Promise.reject(new Error("e2e stub: createEmbeddedCheckoutPage rejected"));
        if (mode === "hang") return new Promise(() => {});
        let frame = null;
        const remove = () => { if (frame) frame.remove(); frame = null; };
        const instance = {
          mount(target) {
            const node = typeof target === "string" ? document.querySelector(target) : target;
            frame = document.createElement("iframe");
            frame.title = "Secure payment form (e2e stub)";
            frame.srcdoc = "<p>Stripe embedded checkout (stub)</p>";
            const height = mode === "delayed-size" ? "0" : "640px";
            frame.style.cssText = "display:block;width:100%;border:0;height:" + height;
            node.appendChild(frame);
            if (mode === "delayed-size") {
              const sized = frame;
              setTimeout(() => { sized.style.height = "640px"; }, sizeDelayMs);
            }
          },
          unmount: remove,
          destroy() {
            remove();
            if (live === instance) live = null;
            seen.destroyed += 1;
          },
        };
        live = instance;
        return Promise.resolve(instance);
      },
    };
  }
  Stripe.version = "endive";
  window.Stripe = Stripe;
})();`;
}

export interface StripeSeen {
  keys: string[];
  secrets: string[];
  /** Embedded Checkouts destroyed. */
  destroyed: number;
}

export interface StripeStub {
  /** Every js.stripe.com URL requested. */
  requests: string[];
  /** What the stub was given in the page: publishable keys, client secrets, and how many forms were destroyed. */
  seen: () => Promise<StripeSeen>;
}

export async function stubStripeJs(page: Page, options: StripeStubOptions = {}): Promise<StripeStub> {
  const requests: string[] = [];
  const body = stubSource(options);
  await page.context().route("https://js.stripe.com/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "application/javascript", body });
  });
  return {
    requests,
    seen: () =>
      page.evaluate(() => {
        const value = (window as unknown as { __stripeE2E?: StripeSeen }).__stripeE2E;
        return value ?? { keys: [], secrets: [], destroyed: 0 };
      }),
  };
}

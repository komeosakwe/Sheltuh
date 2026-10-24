import type { Page } from "@playwright/test";

/**
 * Stripe.js, stubbed: every request to https://js.stripe.com is answered with
 * a script that defines `window.Stripe` (release train "endive", as
 * @stripe/stripe-js expects) whose `createEmbeddedCheckoutPage` records the
 * publishable key and client secret it was given and mounts a plain iframe
 * where Stripe's form would be. Nothing reaches Stripe. It proves our page
 * hands Stripe.js the right secret and mounts the form; it says nothing about
 * the real form's behaviour (declines, 3DS, wallets).
 */
const STUB = `(() => {
  const seen = (window.__stripeE2E = { keys: [], secrets: [] });
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
        seen.secrets.push(options.clientSecret);
        let frame = null;
        const remove = () => { if (frame) frame.remove(); frame = null; };
        return Promise.resolve({
          mount(target) {
            const node = typeof target === "string" ? document.querySelector(target) : target;
            frame = document.createElement("iframe");
            frame.title = "Secure payment form (e2e stub)";
            frame.srcdoc = "<p>Stripe embedded checkout (stub)</p>";
            frame.style.cssText = "display:block;width:100%;height:640px;border:0";
            node.appendChild(frame);
          },
          unmount: remove,
          destroy: remove,
        });
      },
    };
  }
  Stripe.version = "endive";
  window.Stripe = Stripe;
})();`;

export interface StripeStub {
  /** Every js.stripe.com URL requested. */
  requests: string[];
  /** What the stub was given in the page: publishable keys and client secrets. */
  seen: () => Promise<{ keys: string[]; secrets: string[] }>;
}

export async function stubStripeJs(page: Page): Promise<StripeStub> {
  const requests: string[] = [];
  await page.context().route("https://js.stripe.com/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "application/javascript", body: STUB });
  });
  return {
    requests,
    seen: () =>
      page.evaluate(() => {
        const value = (window as unknown as { __stripeE2E?: { keys: string[]; secrets: string[] } }).__stripeE2E;
        return value ?? { keys: [], secrets: [] };
      }),
  };
}

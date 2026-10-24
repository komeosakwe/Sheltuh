/**
 * The payment page's Content Security Policy (proxy.ts sets it on
 * /checkout/pay only). Scripts need this request's nonce (Next puts it on its
 * own scripts while rendering) or the theme script's hash; Stripe.js is
 * loaded by a nonced script, which 'strict-dynamic' trusts, and the
 * js.stripe.com sources are for browsers without 'strict-dynamic'. Stripe's
 * form runs in its own frames.
 *
 * Sent as Content-Security-Policy-Report-Only for now: violations are logged
 * in the browser console, nothing is blocked (see CSP_HEADER).
 */

/**
 * Report-Only until a run against Stripe's sandbox shows no violations. To
 * enforce, set this to "Content-Security-Policy". Next reads the nonce from
 * either request header.
 */
export const CSP_HEADER = "Content-Security-Policy-Report-Only";

export interface CspOptions {
  /** Fresh per request (base64). */
  nonce: string;
  /** The theme script's hash source, `'sha256-…'` (app/layout.tsx inlines THEME_INIT_SCRIPT). */
  themeScriptHash: string;
  /** NEXT_PUBLIC_SUPABASE_URL: auth calls go to its origin. Unset (demo) or invalid: left out. */
  supabaseUrl?: string;
  /** `next dev`: React's dev tools need eval, and HMR a websocket. */
  isDev: boolean;
}

function originOf(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const { origin, protocol } = new URL(url.trim());
    return protocol === "https:" || protocol === "http:" ? origin : undefined;
  } catch {
    return undefined;
  }
}

export function checkoutPayCsp({ nonce, themeScriptHash, supabaseUrl, isDev }: CspOptions): string {
  const stripeScripts = "https://js.stripe.com https://*.js.stripe.com";
  const directives: string[][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      themeScriptHash,
      stripeScripts,
      ...(isDev ? ["'unsafe-eval'"] : []),
    ],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:", "https://*.stripe.com"],
    ["font-src", "'self'"],
    [
      "connect-src",
      "'self'",
      ...[originOf(supabaseUrl)].filter((origin): origin is string => !!origin),
      "https://api.stripe.com",
      "https://checkout.stripe.com",
      ...(isDev ? ["ws:"] : []),
    ],
    ["frame-src", stripeScripts, "https://hooks.stripe.com", "https://checkout.stripe.com"],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'none'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  // Not in dev: `next dev` serves plain http://127.0.0.1, which an enforced policy would upgrade.
  if (!isDev) directives.push(["upgrade-insecure-requests"]);
  return directives.map((parts) => parts.join(" ")).join("; ");
}

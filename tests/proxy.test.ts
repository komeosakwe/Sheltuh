import { createHash } from "node:crypto";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkoutPayCsp, CSP_HEADER } from "@/lib/csp";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { config, proxy } from "../proxy";

/**
 * proxy.ts: the payment page's Content Security Policy, Report-Only for now
 * (lib/csp.ts). The final response headers in a browser, beside
 * next.config.ts's site-wide frame-ancestors policy, are checked in
 * e2e/checkout-csp.spec.ts.
 */

const THEME_HASH = `'sha256-${createHash("sha256").update(THEME_INIT_SCRIPT).digest("base64")}'`;

afterEach(() => {
  vi.unstubAllEnvs();
});

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values];
    }),
  );
}

function run(url = "https://sheltuh.com.au/checkout/pay?order=ord_1", headers: Record<string, string> = {}) {
  const response = proxy(new NextRequest(url, { headers }));
  const policy = response.headers.get("content-security-policy-report-only") ?? "";
  // What Next passes on to the page as request headers (NextResponse.next({ request: { headers } })).
  const forwarded = (name: string) => response.headers.get(`x-middleware-request-${name}`);
  const overridden = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
  return { response, policy, forwarded, overridden };
}

describe("proxy.ts matcher", () => {
  it.each(["/checkout/pay", "/checkout/pay?order=ord_1"])("runs on %s", (url) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
  });

  it.each(["/", "/checkout/success?session_id=ord_1", "/checkout/confirm", "/events/neon-static", "/api/orders/by-session/x/payment", "/checkout/pay/extra"])(
    "doesn't run on %s",
    (url) => {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
    },
  );
});

describe("proxy.ts: the payment page's policy", () => {
  it("is Report-Only for now: nothing enforced, nothing else changed", () => {
    expect(CSP_HEADER).toBe("Content-Security-Policy-Report-Only");
    const { response, policy } = run();
    expect(policy).not.toBe("");
    // next.config.ts's own Content-Security-Policy (frame-ancestors) is left to it.
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("a fresh nonce per request, in the policy and passed to the page (where Next puts it on its scripts)", () => {
    const first = run();
    const second = run();
    const nonce = first.forwarded("x-nonce");
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(second.forwarded("x-nonce")).not.toBe(nonce);
    expect(directives(first.policy).get("script-src")).toContain(`'nonce-${nonce}'`);
    // Next reads the nonce from the policy in the request headers.
    expect(first.forwarded("content-security-policy-report-only")).toBe(first.policy);
  });

  it("never lets a policy the client sent reach the page (Next would take its nonce first)", () => {
    const { overridden, forwarded } = run(undefined, { "content-security-policy": "script-src 'nonce-attacker'" });
    expect(overridden).not.toContain("content-security-policy");
    expect(forwarded("content-security-policy")).toBeNull();
  });

  it("allows the layout's theme script by its hash, computed from the very constant it inlines", () => {
    const { policy } = run();
    expect(directives(policy).get("script-src")).toContain(THEME_HASH);
  });

  it("has every directive the payment page needs, and no more", () => {
    const nonce = "bm9uY2U=";
    const policy = checkoutPayCsp({
      nonce,
      themeScriptHash: THEME_HASH,
      supabaseUrl: "https://abcd.supabase.co/",
      isDev: false,
    });
    expect(policy).toBe(
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${THEME_HASH} https://js.stripe.com https://*.js.stripe.com`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https://*.stripe.com",
        "font-src 'self'",
        "connect-src 'self' https://abcd.supabase.co https://api.stripe.com https://checkout.stripe.com",
        "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
        "worker-src 'self'",
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "upgrade-insecure-requests",
      ].join("; "),
    );
  });

  it("in dev: eval for React's dev tools and a websocket for HMR; no upgrade of http://127.0.0.1", () => {
    const map = directives(checkoutPayCsp({ nonce: "bm9uY2U=", themeScriptHash: THEME_HASH, isDev: true }));
    expect(map.get("script-src")).toContain("'unsafe-eval'");
    expect(map.get("connect-src")).toContain("ws:");
    expect(map.has("upgrade-insecure-requests")).toBe(false);
  });

  it.each([undefined, "", "not a url", "javascript:alert(1)"])("leaves out a Supabase URL that's unset or invalid (%s)", (url) => {
    const map = directives(checkoutPayCsp({ nonce: "bm9uY2U=", themeScriptHash: THEME_HASH, supabaseUrl: url, isDev: false }));
    expect(map.get("connect-src")).toEqual(["'self'", "https://api.stripe.com", "https://checkout.stripe.com"]);
  });

  it("takes the Supabase origin from NEXT_PUBLIC_SUPABASE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://wxyz.supabase.co");
    expect(directives(run().policy).get("connect-src")).toContain("https://wxyz.supabase.co");
  });
});

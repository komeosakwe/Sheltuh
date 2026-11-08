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

describe("proxy.ts: the usage analytics proxy (/ingest)", () => {
  const INGEST = "https://sheltuh.com.au/ingest/e/?ip=0&ver=1.447.3";
  const keyed = () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_abc123");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");
  };
  const post = (url: string, headers: Record<string, string> = {}) =>
    proxy(new NextRequest(url, { method: "POST", headers, body: "{}" }));

  it("runs on /ingest and everything beneath it", () => {
    for (const url of ["/ingest/e/", "/ingest/batch/", "/ingest/static/array.js", "/ingest"]) {
      expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    }
    expect(unstable_doesMiddlewareMatch({ config, url: "/ingestion" })).toBe(false);
  });

  it("has nothing to relay to without NEXT_PUBLIC_POSTHOG_KEY: 404", () => {
    const response = post(INGEST);
    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("relays an event to the PostHog host with its query, and removes cookies, Referer and Origin on the way", () => {
    keyed();
    const response = post(INGEST, {
      cookie: "sb-access-token=secret",
      referer: "https://sheltuh.com.au/members/6f1c2b9e-1111-4222-8333-944455556666",
      origin: "https://sheltuh.com.au",
      authorization: "Bearer secret",
      "content-type": "text/plain",
      "user-agent": "Mozilla/5.0 Chrome/120",
    });
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://eu.i.posthog.com/e/?ip=0&ver=1.447.3");
    const overridden = (response.headers.get("x-middleware-override-headers") ?? "").split(",");
    for (const name of ["cookie", "referer", "origin", "authorization"]) {
      expect(overridden).not.toContain(name);
    }
    expect(overridden).toContain("user-agent");
    expect(overridden).toContain("content-type");
    expect(response.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(response.headers.get("x-middleware-request-referer")).toBeNull();
  });

  it("answers with nosniff and a sandbox policy", () => {
    keyed();
    const response = post(INGEST);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
  });

  it("adds the trailing slash PostHog's endpoints end in", () => {
    keyed();
    expect(post("https://sheltuh.com.au/ingest/e").headers.get("x-middleware-rewrite")).toBe("https://eu.i.posthog.com/e/");
    expect(post("https://sheltuh.com.au/ingest/batch/").headers.get("x-middleware-rewrite")).toBe("https://eu.i.posthog.com/batch/");
  });

  it.each(["/ingest/static/array.js", "/ingest/array/phc_abc123/config.js", "/ingest/flags/", "/ingest/api/projects/", "/ingest/s/", "/ingest"])(
    "refuses %s: not an endpoint the browser needs",
    (path) => {
      keyed();
      const response = post(`https://sheltuh.com.au${path}`);
      expect(response.status).toBe(404);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    },
  );

  it("refuses anything but POST", () => {
    keyed();
    for (const method of ["GET", "PUT", "DELETE"]) {
      const response = proxy(new NextRequest(INGEST, { method }));
      expect(response.status).toBe(405);
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    }
  });
});

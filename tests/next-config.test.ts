import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig, { assertStripePublishableKey } from "../next.config";

async function headersFor(source: string) {
  const rules = await nextConfig.headers?.();
  const rule = rules?.find((r) => r.source === source);
  expect(rule).toBeDefined();
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

describe("next.config headers", () => {
  it("forbids framing on every path: X-Frame-Options DENY and CSP frame-ancestors 'none', nothing else", async () => {
    const byKey = await headersFor("/:path*");
    expect(byKey).toEqual({ "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" });
    // First, so a more specific rule's header of the same name (the /sw.js CSP) overrides it (the last match wins).
    const rules = (await nextConfig.headers?.()) ?? [];
    expect(rules[0].source).toBe("/:path*");
  });

  it("serves /sw.js uncacheable, as JavaScript, with a locked-down CSP", async () => {
    const byKey = await headersFor("/sw.js");
    expect(byKey["content-type"]).toBe("application/javascript; charset=utf-8");
    expect(byKey["cache-control"]).toMatch(/no-cache/);
    expect(byKey["cache-control"]).toMatch(/must-revalidate/);
    expect(byKey["content-security-policy"]).toBe("default-src 'self'; script-src 'self'");
  });

  it("keeps checkout URLs (they carry the order id or a confirmation token) out of Referers and search indexes", async () => {
    const byKey = await headersFor("/checkout/:path*");
    expect(byKey["referrer-policy"]).toBe("no-referrer");
    expect(byKey["x-robots-tag"]).toMatch(/\bnoindex\b/);
  });

  it.each(["/waitlist/:path*", "/following/:path*"])(
    "keeps the emailed-link page %s (a token in its fragment) out of Referers and search indexes, like checkout",
    async (source) => {
      const byKey = await headersFor(source);
      expect(byKey).toEqual({ "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
    },
  );

  it("sends only the origin as a Referer from /search, whose address can hold the visitor's suburb (near=)", async () => {
    expect(await headersFor("/search")).toEqual({ "referrer-policy": "strict-origin" });
  });

  it("caches the door scanner's versioned WASM decoder for a year, as immutable", async () => {
    const byKey = await headersFor("/vendor/zxing-wasm/:path*");
    expect(byKey["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(Object.keys(byKey)).toEqual(["cache-control"]);
  });

  it("leaves /sw.js's CSP alone: the WASM rule can't match it", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const wasmRule = rules.find((r) => r.source.startsWith("/vendor/"));
    expect(wasmRule?.source.startsWith("/sw")).toBe(false);
    expect(rules.filter((r) => r.headers.some((h) => h.key.toLowerCase() === "content-security-policy")).map((r) => r.source)).toEqual([
      "/:path*",
      "/sw.js",
    ]);
  });

  it("adds headers to no other path (deliberately: each rule above has a reason)", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules?.map((r) => r.source)).toEqual([
      "/:path*",
      "/sw.js",
      "/checkout/:path*",
      "/waitlist/:path*",
      "/following/:path*",
      "/search",
      "/vendor/zxing-wasm/:path*",
    ]);
  });
});

describe("next.config: NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("accepts it unset or blank (demo mode, CI), and any pk_test_ or pk_live_ key, e2e's placeholder included", () => {
    for (const value of [undefined, "", "   ", "pk_test_e2e_placeholder", "pk_live_" + "51AbCdEf", " pk_test_51AbCdEf\n"]) {
      expect(() => assertStripePublishableKey(value)).not.toThrow();
    }
  });

  it("refuses anything else, naming the variable and never the value", () => {
    const bad = [
      "sk_live_" + "51SecretValue",
      "sk_test_" + "51SecretValue",
      "rk_live_" + "51SecretValue",
      "whsec_" + "51SecretValue",
      "pk_51SecretValue",
      "PK_TEST_51SecretValue",
      "pk_prod_51SecretValue",
      "51SecretValue",
    ];
    for (const value of bad) {
      let message = "";
      try {
        assertStripePublishableKey(value);
      } catch (err) {
        message = err instanceof Error ? err.message : String(err);
      }
      expect(message).toMatch(/^NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be a Stripe publishable key/);
      expect(message).not.toContain("51SecretValue");
    }
  });

  it("runs when the config is loaded: a bad key fails the load (so `next build`), a good or missing one doesn't", async () => {
    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "sk_live_" + "51SecretValue");
    vi.resetModules();
    await expect(import("../next.config")).rejects.toThrow(/NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY must be/);

    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "pk_test_e2e_placeholder");
    vi.resetModules();
    expect((await import("../next.config")).default.headers).toBeTypeOf("function");

    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
    vi.resetModules();
    expect((await import("../next.config")).default.headers).toBeTypeOf("function");
  });
});

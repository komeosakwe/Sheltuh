import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import config, { assertOAuthLogos, assertStripePublishableKey, nextConfig } from "../next.config";

async function headersFor(source: string) {
  const rules = await nextConfig.headers?.();
  const rule = rules?.find((r) => r.source === source);
  expect(rule).toBeDefined();
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

describe("next.config headers", () => {
  it("forbids framing on every path (X-Frame-Options DENY, CSP frame-ancestors 'none') and sends HSTS, nothing else", async () => {
    const byKey = await headersFor("/:path*");
    expect(byKey).toEqual({
      "x-frame-options": "DENY",
      "content-security-policy": "frame-ancestors 'none'",
      "strict-transport-security": "max-age=63072000",
    });
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

  it.each(["/waitlist/:path*", "/following/:path*", "/invite", "/organisers/join"])(
    "keeps the emailed or shared link page %s (a token in its fragment) out of Referers and search indexes, like checkout",
    async (source) => {
      const byKey = await headersFor(source);
      expect(byKey).toEqual({ "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
    },
  );

  it("keeps the OAuth callback (/auth/callback?code=…, a one-time sign-in code) out of Referers and search indexes", async () => {
    expect(await headersFor("/auth/:path*")).toEqual({ "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow" });
  });

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
      "/invite",
      "/organisers/join",
      "/auth/:path*",
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
    expect((await import("../next.config")).nextConfig.headers).toBeTypeOf("function");

    vi.stubEnv("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", undefined);
    vi.resetModules();
    expect((await import("../next.config")).nextConfig.headers).toBeTypeOf("function");
  });
});

/** Google's logo (lib/auth/oauth-providers.ts), in OAUTH_LOGO_FILES order. */
const GOOGLE_FILES = ["google-g.svg"];

describe("next.config: the official sign-in logos must be there for each provider NEXT_PUBLIC_AUTH_PROVIDERS lists", () => {
  let dir = "";
  const publicDir = () => path.join(dir, "public");
  const addLogos = (...files: string[]) => {
    mkdirSync(path.join(publicDir(), "auth"), { recursive: true });
    for (const file of files) writeFileSync(path.join(publicDir(), "auth", file), "<svg/>");
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sheltuh-logos-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("passes with no provider listed (the default), whatever is in public/auth", () => {
    for (const value of [undefined, "", " , ", "github"]) expect(() => assertOAuthLogos(value, publicDir())).not.toThrow();
  });

  it("fails naming every missing file (and where to read about them) for each listed provider", () => {
    addLogos("README.md");
    expect(() => assertOAuthLogos("google,apple", publicDir())).toThrow(
      "NEXT_PUBLIC_AUTH_PROVIDERS lists a provider whose official logo artwork is missing: " +
        "public/auth/google-g.svg, " +
        "public/auth/apple-logo-white.svg, public/auth/apple-logo-black.svg. " +
        "Add the files described in docs/auth-logos.md, or take the provider out of NEXT_PUBLIC_AUTH_PROVIDERS.",
    );
    addLogos("apple-logo-white.svg");
    expect(() => assertOAuthLogos("apple", publicDir())).toThrow(/missing: public\/auth\/apple-logo-black\.svg\. /);
  });

  it("passes once a provider's files are all there, checking only the providers listed", () => {
    expect(() => assertOAuthLogos("google", publicDir())).toThrow(/missing: public\/auth\/google-g\.svg\. /);
    addLogos("google-g.svg");
    expect(() => assertOAuthLogos("google", publicDir())).not.toThrow();
    expect(() => assertOAuthLogos("apple", publicDir())).toThrow(/apple-logo-white\.svg, public\/auth\/apple-logo-black\.svg/);
    addLogos("apple-logo-white.svg", "apple-logo-black.svg");
    expect(() => assertOAuthLogos(" Google , APPLE ", publicDir())).not.toThrow();
  });

  it("runs in the production-build phase only (`next build`, `next typegen`), so `next dev` and `next start` load without the files", () => {
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "google,apple");
    expect(() => config(PHASE_PRODUCTION_BUILD)).toThrow(/public\/auth\/google-g\.svg/);
    expect(config(PHASE_DEVELOPMENT_SERVER)).toBe(nextConfig);
    expect(config(PHASE_PRODUCTION_SERVER)).toBe(nextConfig);

    addLogos(...GOOGLE_FILES, "apple-logo-white.svg", "apple-logo-black.svg");
    expect(config(PHASE_PRODUCTION_BUILD)).toBe(nextConfig);

    vi.stubEnv("NEXT_PUBLIC_AUTH_PROVIDERS", "");
    rmSync(path.join(publicDir(), "auth"), { recursive: true });
    expect(config(PHASE_PRODUCTION_BUILD)).toBe(nextConfig);
  });
});

describe("public/auth: Google's G is committed (docs/auth-logos.md)", () => {
  const repoPublic = path.resolve(import.meta.dirname, "../public");

  it("is there, so a build listing google passes", () => {
    expect(() => assertOAuthLogos("google", repoPublic)).not.toThrow();
  });

  it("is the four-colour G: Google's red, blue, yellow and green, with no scripts", () => {
    const svg = readFileSync(path.join(repoPublic, "auth", "google-g.svg"), "utf8");
    for (const fill of ["#EA4335", "#4285F4", "#FBBC05", "#34A853"]) expect(svg).toContain(`fill="${fill}"`);
    expect(svg).not.toMatch(/<script|\son\w+\s*=/i);
    // Google's own file (FirebaseUI's image/google.svg), unmodified: docs/auth-logos.md.
    expect(createHash("sha256").update(readFileSync(path.join(repoPublic, "auth", "google-g.svg"))).digest("hex")).toBe(
      "cbe9772630b9b72daf7c14eab28c6c86f88e07da9cb08487544e022e385ede1f",
    );
  });

  it("no longer ships the retired whole-button images", () => {
    for (const file of ["google-signin-light@2x.png", "google-signin-light@4x.png", "google-signin-dark@2x.png", "google-signin-dark@4x.png"]) {
      expect(existsSync(path.join(repoPublic, "auth", file))).toBe(false);
    }
  });
});

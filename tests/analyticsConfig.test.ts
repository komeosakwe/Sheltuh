import { describe, expect, it } from "vitest";
import { assertPostHogKey, DEFAULT_POSTHOG_HOST, ingestRewrites, resolveAnalyticsConfig } from "@/lib/analytics-config";
import { isVercelAnalyticsEnabled } from "@/lib/vercel-analytics";

describe("resolveAnalyticsConfig", () => {
  it("is off without a key, or with one that isn't a project key", () => {
    expect(resolveAnalyticsConfig(undefined, undefined)).toBeNull();
    expect(resolveAnalyticsConfig("", "https://us.i.posthog.com")).toBeNull();
    expect(resolveAnalyticsConfig("   ", undefined)).toBeNull();
    expect(resolveAnalyticsConfig("phx_personal", undefined)).toBeNull();
  });

  it("defaults to the US cloud", () => {
    expect(resolveAnalyticsConfig("phc_abc123", undefined)).toEqual({
      key: "phc_abc123",
      apiHost: DEFAULT_POSTHOG_HOST,
      assetsHost: "https://us-assets.i.posthog.com",
      uiHost: "https://us.posthog.com",
    });
  });

  it("derives the EU cloud's assets and app hosts", () => {
    expect(resolveAnalyticsConfig("phc_abc123", " https://eu.i.posthog.com/ ")).toEqual({
      key: "phc_abc123",
      apiHost: "https://eu.i.posthog.com",
      assetsHost: "https://eu-assets.i.posthog.com",
      uiHost: "https://eu.posthog.com",
    });
  });

  it("serves a self-hosted instance's three roles from the one host, and refuses a host that isn't http(s)", () => {
    expect(resolveAnalyticsConfig("phc_abc123", "https://ph.example.org")).toMatchObject({
      apiHost: "https://ph.example.org",
      assetsHost: "https://ph.example.org",
      uiHost: "https://ph.example.org",
    });
    expect(resolveAnalyticsConfig("phc_abc123", "javascript:alert(1)")).toBeNull();
    expect(resolveAnalyticsConfig("phc_abc123", "not a url")).toBeNull();
  });
});

describe("assertPostHogKey", () => {
  it("accepts unset, empty and a project key", () => {
    expect(() => assertPostHogKey(undefined)).not.toThrow();
    expect(() => assertPostHogKey("")).not.toThrow();
    expect(() => assertPostHogKey("phc_abc123")).not.toThrow();
  });

  it("refuses any other key, naming the variable and never the value", () => {
    expect(() => assertPostHogKey("phx_supersecretpersonalkey")).toThrow(/NEXT_PUBLIC_POSTHOG_KEY/);
    try {
      assertPostHogKey("phx_supersecretpersonalkey");
    } catch (err) {
      expect(String(err)).not.toContain("supersecretpersonalkey");
    }
  });
});

describe("ingestRewrites", () => {
  it("has no route at all while analytics is off", () => {
    expect(ingestRewrites(null)).toEqual([]);
  });

  it("proxies /ingest to PostHog, static files and remote config to its assets host first", () => {
    const config = resolveAnalyticsConfig("phc_abc123", "https://us.i.posthog.com");
    expect(ingestRewrites(config)).toEqual([
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://us-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ]);
  });
});

describe("isVercelAnalyticsEnabled", () => {
  it("is on only for a Vercel build", () => {
    expect(isVercelAnalyticsEnabled({ VERCEL: "1" })).toBe(true);
    expect(isVercelAnalyticsEnabled({})).toBe(false);
    expect(isVercelAnalyticsEnabled({ VERCEL: "" })).toBe(false);
  });

  it("has an off switch, NEXT_PUBLIC_VERCEL_ANALYTICS=0", () => {
    expect(isVercelAnalyticsEnabled({ VERCEL: "1", NEXT_PUBLIC_VERCEL_ANALYTICS: "0" })).toBe(false);
    expect(isVercelAnalyticsEnabled({ VERCEL: "1", NEXT_PUBLIC_VERCEL_ANALYTICS: "1" })).toBe(true);
    expect(isVercelAnalyticsEnabled({ VERCEL: "1", NEXT_PUBLIC_VERCEL_ANALYTICS: "" })).toBe(true);
  });
});

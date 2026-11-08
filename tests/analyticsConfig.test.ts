import { describe, expect, it } from "vitest";
import { assertPostHogHost, assertPostHogKey, DEFAULT_POSTHOG_HOST, ingestTarget, resolveAnalyticsConfig } from "@/lib/analytics-config";
import { isVercelAnalyticsEnabled } from "@/lib/vercel-analytics";

describe("resolveAnalyticsConfig", () => {
  it("is off without a key, or with one that isn't a project key", () => {
    expect(resolveAnalyticsConfig(undefined, undefined)).toBeNull();
    expect(resolveAnalyticsConfig("", "https://us.i.posthog.com")).toBeNull();
    expect(resolveAnalyticsConfig("   ", undefined)).toBeNull();
    expect(resolveAnalyticsConfig("phx_personal", undefined)).toBeNull();
  });

  it("defaults to the EU cloud, so a missing host can't send data to the US", () => {
    expect(DEFAULT_POSTHOG_HOST).toBe("https://eu.i.posthog.com");
    for (const host of [undefined, "", "  "]) {
      expect(resolveAnalyticsConfig("phc_abc123", host)).toEqual({
        key: "phc_abc123",
        apiHost: "https://eu.i.posthog.com",
        uiHost: "https://eu.posthog.com",
      });
    }
  });

  it("still takes the US cloud when it is asked for", () => {
    expect(resolveAnalyticsConfig("phc_abc123", "https://us.i.posthog.com")).toMatchObject({
      apiHost: "https://us.i.posthog.com",
      uiHost: "https://us.posthog.com",
    });
  });

  it("derives the EU cloud's assets and app hosts", () => {
    expect(resolveAnalyticsConfig("phc_abc123", " https://eu.i.posthog.com/ ")).toEqual({
      key: "phc_abc123",
      apiHost: "https://eu.i.posthog.com",
      uiHost: "https://eu.posthog.com",
    });
  });

  it("serves a self-hosted instance's three roles from the one host, and refuses a host that isn't http(s)", () => {
    expect(resolveAnalyticsConfig("phc_abc123", "https://ph.example.org")).toMatchObject({
      apiHost: "https://ph.example.org",
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

describe("assertPostHogHost", () => {
  it("accepts an unset host, a usable host, and any host while analytics is off", () => {
    expect(() => assertPostHogHost("phc_abc123", undefined)).not.toThrow();
    expect(() => assertPostHogHost("phc_abc123", "")).not.toThrow();
    expect(() => assertPostHogHost("phc_abc123", "https://eu.i.posthog.com")).not.toThrow();
    expect(() => assertPostHogHost(undefined, "garbage")).not.toThrow();
  });

  it("refuses a malformed or non-https host once a key is set, naming the variable and not the value", () => {
    for (const host of ["us.i.posthog.com", "http://us.i.posthog.com", "javascript:alert(1)", "https://"]) {
      expect(() => assertPostHogHost("phc_abc123", host)).toThrow(/NEXT_PUBLIC_POSTHOG_HOST/);
    }
    try {
      assertPostHogHost("phc_abc123", "http://secret-host.example");
    } catch (err) {
      expect(String(err)).not.toContain("secret-host");
    }
  });
});

describe("ingestTarget", () => {
  it("allows only the endpoints PostHog needs to receive events, adding the trailing slash", () => {
    expect(ingestTarget("/ingest/e/")).toBe("/e/");
    expect(ingestTarget("/ingest/e")).toBe("/e/");
    expect(ingestTarget("/ingest/i/v0/e/")).toBe("/i/v0/e/");
    expect(ingestTarget("/ingest/batch/")).toBe("/batch/");
  });

  it("refuses everything else, including the rest of PostHog's API and path tricks", () => {
    for (const path of [
      "/ingest",
      "/ingest/",
      "/ingest/static/array.js",
      "/ingest/array/phc_abc123/config.js",
      "/ingest/flags/",
      "/ingest/decide/",
      "/ingest/s/",
      "/ingest/api/projects/",
      "/ingest/e/../api/",
      "/ingest/e/x/",
      "/ingestx/e/",
      "/other/e/",
    ]) {
      expect(ingestTarget(path)).toBeNull();
    }
  });
});

describe("isVercelAnalyticsEnabled", () => {
  it("is on only for a live-mode Vercel build", () => {
    expect(isVercelAnalyticsEnabled({ VERCEL: "1" }, true)).toBe(true);
    expect(isVercelAnalyticsEnabled({}, true)).toBe(false);
    expect(isVercelAnalyticsEnabled({ VERCEL: "" }, true)).toBe(false);
  });

  it("is off in demo mode, even on Vercel", () => {
    expect(isVercelAnalyticsEnabled({ VERCEL: "1" }, false)).toBe(false);
  });

  it("has an off switch, NEXT_PUBLIC_VERCEL_ANALYTICS=0", () => {
    expect(isVercelAnalyticsEnabled({ VERCEL: "1", NEXT_PUBLIC_VERCEL_ANALYTICS: "0" }, true)).toBe(false);
    expect(isVercelAnalyticsEnabled({ VERCEL: "1", NEXT_PUBLIC_VERCEL_ANALYTICS: "1" }, true)).toBe(true);
    expect(isVercelAnalyticsEnabled({ VERCEL: "1", NEXT_PUBLIC_VERCEL_ANALYTICS: "" }, true)).toBe(true);
  });
});

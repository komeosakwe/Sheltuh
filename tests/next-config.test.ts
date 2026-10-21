import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

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
    expect(rules?.map((r) => r.source)).toEqual(["/:path*", "/sw.js", "/checkout/:path*", "/vendor/zxing-wasm/:path*"]);
  });
});

import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

async function headersFor(source: string) {
  const rules = await nextConfig.headers?.();
  const rule = rules?.find((r) => r.source === source);
  expect(rule).toBeDefined();
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
}

describe("next.config headers", () => {
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

  it("adds headers to no other path (deliberately: each rule above has a reason)", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules?.map((r) => r.source)).toEqual(["/sw.js", "/checkout/:path*"]);
  });
});

import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config headers", () => {
  it("serves /sw.js uncacheable, as JavaScript, with a locked-down CSP", async () => {
    const rules = await nextConfig.headers?.();
    const rule = rules?.find((r) => r.source === "/sw.js");
    expect(rule).toBeDefined();
    const byKey = Object.fromEntries((rule?.headers ?? []).map((h) => [h.key.toLowerCase(), h.value]));
    expect(byKey["content-type"]).toBe("application/javascript; charset=utf-8");
    expect(byKey["cache-control"]).toMatch(/no-cache/);
    expect(byKey["cache-control"]).toMatch(/must-revalidate/);
    expect(byKey["content-security-policy"]).toBe("default-src 'self'; script-src 'self'");
  });

  it("does not add headers to any other path", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules?.map((r) => r.source)).toEqual(["/sw.js"]);
  });
});

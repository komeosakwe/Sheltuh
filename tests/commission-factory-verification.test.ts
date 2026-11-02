import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Commission Factory re-checks this file at the site root to keep sheltuh.com.au verified:
// it must stay in public/ with exactly this name and contents.
describe("Commission Factory site verification file", () => {
  it("is served from public/ with its token", () => {
    const body = readFileSync(join(process.cwd(), "public", "commission-factory-09c81982a7a041f488a5d9c153d5cd44.html"), "utf8");
    expect(body).toBe("commission-factory-verification=09c81982a7a041f488a5d9c153d5cd44");
  });
});

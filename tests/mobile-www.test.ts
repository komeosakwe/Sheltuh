import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** The phone app's bundled fallback page (mobile/www/index.html, docs/mobile-app.md). */
const html = fs.readFileSync(path.resolve(import.meta.dirname, "../mobile/www/index.html"), "utf8");

describe("mobile/www/index.html", () => {
  it("allows exactly its own inline script (the hash in its CSP matches)", () => {
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toHaveLength(1);
    const hash = createHash("sha256").update(scripts[0], "utf8").digest("base64");
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain(`script-src 'sha256-${hash}'`);
  });

  it("is self-contained: no requests to any server, no other files", () => {
    expect(html).not.toMatch(/\b(?:src|href)=/);
    expect(html).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(html).not.toMatch(/@import|url\(/);
  });

  it("says what's wrong and what to do, and offers Try again only when there's a page to go back to", () => {
    expect(html).toContain("Sheltüh couldn&rsquo;t load");
    // Neutral: it also shows when the site is down or the WebView is too old, not only offline.
    expect(html).not.toMatch(/offline|no connection/i);
    expect(html).toMatch(/<button type="button" id="retry" hidden>Try again<\/button>/);
    expect(html).toContain("window.history.length > 1");
    expect(html).toContain("close Sheltüh and open it again");
  });
});

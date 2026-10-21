import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * globals.css rules that keep content reachable: the reveal entrance never
 * hides anything in print (WCAG 1.3.1), and the map's phone sheet never
 * covers keyboard focus (2.4.11).
 */
const css = readFileSync(path.resolve(import.meta.dirname, "..", "app/globals.css"), "utf8");

/** Each top-level `@media …` block: its query and its body (braces balanced). */
function mediaBlocks(): { query: string; body: string }[] {
  const blocks: { query: string; body: string }[] = [];
  const re = /@media\s+([^{]+)\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(css))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
    }
    blocks.push({ query: match[1].trim(), body: css.slice(re.lastIndex, i - 1) });
  }
  return blocks;
}

/** The declarations of `selector`'s rule inside `body`. */
function declarations(body: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("reveal entrances in globals.css", () => {
  it("has one reveal system: no CSS scroll-timeline .reveal class beside RevealObserver's", () => {
    expect(css).not.toMatch(/\.reveal\s*\{/);
    expect(css).not.toMatch(/animation-timeline/);
  });

  it("hides .reveal-pending only on screens, for people who haven't asked for less motion", () => {
    const hiding = mediaBlocks().filter(({ body }) => /\.reveal-pending\s*\{[^}]*opacity:\s*0/.test(body));
    expect(hiding).toHaveLength(1);
    expect(hiding[0].query).toBe("screen and (prefers-reduced-motion: no-preference)");
    // Never outside a media query, where it would apply to print too.
    const outside = css.replace(/@media[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    expect(outside).not.toMatch(/\.reveal-pending/);
  });

  it("shows everything in print, whatever an entrance was doing", () => {
    const print = mediaBlocks().find(({ query }) => query === "print");
    expect(print).toBeDefined();
    const rule = declarations(print?.body ?? "", ".reveal-pending");
    expect(rule).toMatch(/opacity:\s*1\s*!important/);
    expect(rule).toMatch(/transform:\s*none\s*!important/);
  });
});

describe("the map's phone sheet in globals.css", () => {
  it("pads focus scrolling and the page's end by the sheet's height below lg", () => {
    const phone = mediaBlocks().find(({ query }) => query === "(width < 64rem)");
    expect(phone).toBeDefined();
    expect(declarations(phone?.body ?? "", "html:has([data-map-sheet])")).toMatch(
      /scroll-padding-bottom:\s*calc\(var\(--map-sheet-h, 0px\) \+ 0\.75rem\)/,
    );
    expect(declarations(phone?.body ?? "", "html:has([data-map-sheet]) [data-page-end]")).toMatch(
      /padding-bottom:\s*var\(--map-sheet-h, 0px\)/,
    );
  });
});

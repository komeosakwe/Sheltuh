import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * globals.css rules that keep content reachable: nothing is hidden until a
 * scroll reveals it (docs/design/mobile-redesign.md §8.1), and the map's
 * phone sheet never covers keyboard focus (2.4.11).
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

describe("no scroll-reveal in globals.css (mobile-redesign.md §8.1)", () => {
  it("has no class that hides content until it scrolls into view", () => {
    expect(css).not.toMatch(/\.reveal(-pending)?\b/);
    expect(css).not.toMatch(/animation-timeline/);
  });

  it("never hides a page's overflow sideways: causes are fixed instead (§8.2)", () => {
    const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(declarations(withoutComments, "body")).toMatch(/padding-left:\s*env\(safe-area-inset-left\)/);
    expect(declarations(withoutComments, "body")).not.toMatch(/overflow-x:\s*hidden/);
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

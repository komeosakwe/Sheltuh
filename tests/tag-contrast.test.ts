import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_CATEGORIES } from "@/lib/types";

/**
 * The category tags' tints (app/globals.css `[data-tag]`, the rules' Colour
 * board "Category tints"): every pair is readable both ways round, since
 * Light sets the text on the tint and Dark (and ink) swaps them. WCAG 1.4.3:
 * at least 4.5:1 for the tags' 12px text.
 */
const css = readFileSync(path.resolve(import.meta.dirname, "../app/globals.css"), "utf8");

function channel(value: number) {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The tint and ink a `[data-tag="…"]` rule declares (the last rule that names it). */
function pair(tone: string): { tint: string; ink: string } {
  const rules = [...css.matchAll(/((?:\[data-tag="[\w-]+"\],?\s*)+)\{([^}]*)\}/g)].filter(([, selectors]) =>
    selectors.includes(`[data-tag="${tone}"]`),
  );
  const body = rules.at(-1)?.[2] ?? "";
  const tint = body.match(/--tag-tint:\s*(#[0-9a-f]{6});/)?.[1];
  const ink = body.match(/--tag-ink:\s*(#[0-9a-f]{6});/)?.[1];
  if (!tint || !ink) throw new Error(`no tag pair for ${tone}`);
  return { tint, ink };
}

const TONES = [...EVENT_CATEGORIES.map((category) => category.value), "fashion", "free", "neutral"];

describe("category tag tints", () => {
  it.each(TONES)("%s: the tint and its text are at least 4.5:1, in Light and swapped in Dark", (tone) => {
    const { tint, ink } = pair(tone);
    expect(contrast(tint, ink)).toBeGreaterThanOrEqual(4.5);
  });

  it("uses the rules' values for every category the site has", () => {
    expect(pair("live-music")).toEqual({ tint: "#ece6fa", ink: "#4b3b8c" });
    expect(pair("art")).toEqual({ tint: "#e3effa", ink: "#1f4e79" });
    expect(pair("workshop")).toEqual({ tint: "#fcebd6", ink: "#8a4b0f" });
    expect(pair("pop-up")).toEqual({ tint: "#e2f2e5", ink: "#2e6b3a" });
    expect(pair("theatre")).toEqual({ tint: "#f8e2e7", ink: "#8c2f45" });
    expect(pair("free")).toEqual({ tint: "#eeece7", ink: "#3a3936" });
  });

  it("has a tint for every category in lib/types, so no category falls back unnoticed", () => {
    for (const { value } of EVENT_CATEGORIES) expect(css).toContain(`[data-tag="${value}"]`);
  });

  it("sets the text on the tint in Light, and swaps them in Dark and inside ink (screen only for Dark), with paper pinned to Light", () => {
    expect(css).toMatch(/\[data-tag\] \{[^}]*background-color: var\(--tag-tint\);\s*color: var\(--tag-ink\);/);
    expect(css).toMatch(/\[data-surface="ink"\] \[data-tag\] \{\s*background-color: var\(--tag-ink\);\s*color: var\(--tag-tint\);/);
    expect(css).toMatch(
      /@media screen \{\s*\[data-theme="dark"\] \[data-tag\] \{\s*background-color: var\(--tag-ink\);\s*color: var\(--tag-tint\);\s*\}\s*\[data-theme="dark"\] \[data-surface="paper"\] \[data-tag\] \{\s*background-color: var\(--tag-tint\);\s*color: var\(--tag-ink\);/,
    );
  });
});

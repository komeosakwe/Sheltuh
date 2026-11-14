import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EVENT_CATEGORIES } from "@/lib/types";

/**
 * The category tags' tints (app/globals.css `[data-tag]`, the rules' Colour
 * board "Category tints"): each tone has a Light pair and a Dark pair (used
 * in Dark and inside ink), each readable. WCAG 1.4.3: at least 4.5:1 for the
 * tags' 12px text.
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

/** The Light and Dark pairs a `[data-tag="…"]` rule declares (the last rule that names it). */
function pair(tone: string): { tint: string; ink: string; tintDark: string; inkDark: string } {
  const rules = [...css.matchAll(/((?:\[data-tag="[\w-]+"\],?\s*)+)\{([^}]*)\}/g)].filter(([, selectors]) =>
    selectors.includes(`[data-tag="${tone}"]`),
  );
  const body = rules.at(-1)?.[2] ?? "";
  const value = (name: string) => body.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6});`))?.[1];
  const [tint, ink, tintDark, inkDark] = ["--tag-tint", "--tag-ink", "--tag-tint-dark", "--tag-ink-dark"].map(value);
  if (!tint || !ink || !tintDark || !inkDark) throw new Error(`no tag pairs for ${tone}`);
  return { tint, ink, tintDark, inkDark };
}

const TONES = [...EVENT_CATEGORIES.map((category) => category.value), "fashion", "free", "neutral", "soon"];

describe("category tag tints", () => {
  it.each(TONES)("%s: the tint and its text are at least 4.5:1, in Light and in Dark", (tone) => {
    const { tint, ink, tintDark, inkDark } = pair(tone);
    expect(contrast(tint, ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tintDark, inkDark)).toBeGreaterThanOrEqual(4.5);
    // The Dark tint is a dark fill (it sits on the black page), its text light.
    expect(luminance(tintDark)).toBeLessThan(luminance(inkDark));
  });

  it("uses the rules' values for every category the site has", () => {
    expect(pair("live-music")).toMatchObject({ tint: "#ece6fa", ink: "#4b3b8c" });
    expect(pair("art")).toMatchObject({ tint: "#e3effa", ink: "#1f4e79" });
    expect(pair("workshop")).toMatchObject({ tint: "#fcebd6", ink: "#8a4b0f" });
    expect(pair("pop-up")).toMatchObject({ tint: "#e2f2e5", ink: "#2e6b3a" });
    expect(pair("theatre")).toMatchObject({ tint: "#f8e2e7", ink: "#8c2f45" });
    expect(pair("free")).toMatchObject({ tint: "#eeece7", ink: "#3a3936" });
    // The Dark pairs from the visual QA's samples.
    expect(pair("live-music")).toMatchObject({ tintDark: "#2a2340", inkDark: "#c9b8ff" });
    expect(pair("theatre")).toMatchObject({ tintDark: "#3a1e25", inkDark: "#f0afbf" });
    expect(pair("workshop")).toMatchObject({ tintDark: "#3a2a1a", inkDark: "#f3c48e" });
    expect(pair("free")).toMatchObject({ tintDark: "#171715", inkDark: "#d6d3cc" });
    // The "soon" tag ("🔥 Tomorrow"): coral, apart from workshop's tan.
    expect(pair("soon")).toMatchObject({ tint: "#ffdccb", ink: "#8f2500", tintDark: "#3d1a0c", inkDark: "#ff8a5c" });
    expect(pair("soon").tint).not.toBe(pair("workshop").tint);
  });

  it("has a tint for every category in lib/types, so no category falls back unnoticed", () => {
    for (const { value } of EVENT_CATEGORIES) expect(css).toContain(`[data-tag="${value}"]`);
  });

  it("uses the Light pair by default, the Dark pair in Dark and inside ink (screen only for Dark), with paper pinned to Light", () => {
    expect(css).toMatch(/\[data-tag\] \{[^}]*background-color: var\(--tag-tint\);\s*color: var\(--tag-ink\);/);
    expect(css).toMatch(/\[data-surface="ink"\] \[data-tag\] \{\s*background-color: var\(--tag-tint-dark\);\s*color: var\(--tag-ink-dark\);/);
    expect(css).toMatch(
      /@media screen \{\s*\[data-theme="dark"\] \[data-tag\] \{\s*background-color: var\(--tag-tint-dark\);\s*color: var\(--tag-ink-dark\);\s*\}\s*\[data-theme="dark"\] \[data-surface="paper"\] \[data-tag\] \{\s*background-color: var\(--tag-tint\);\s*color: var\(--tag-ink\);/,
    );
  });
});

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Bootzy, the display face (app/fonts.ts, app/fonts/bootzy/README.md): the
 * file and its README are in the repo, it's loaded with no size-adjusted
 * fallback (so the glyphs it lacks fall to Instrument Sans, not Arial), at
 * its one weight, and the display stack ends in the sans face. The dotted
 * body face it replaces is gone.
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const fonts = read("app/fonts.ts");
const layout = read("app/layout.tsx");
const css = read("app/globals.css");

describe("Bootzy", () => {
  it("ships the WOFF2 and a README that says where it came from and that its licence is the owner's", () => {
    const file = path.join(root, "app/fonts/bootzy/Bootzy-Regular.woff2");
    expect(existsSync(file)).toBe(true);
    // A real WOFF2: its signature, and more than a stub.
    expect(readFileSync(file).subarray(0, 4).toString("latin1")).toBe("wOF2");
    expect(statSync(file).size).toBeGreaterThan(50_000);
    const readme = read("app/fonts/bootzy/README.md");
    expect(readme).toMatch(/owner-supplied/);
    expect(readme).toMatch(/## Licence/);
    expect(readme).toMatch(/adjustFontFallback: false/);
  });

  it("loads it with next/font/local at weight 400, preloaded, with adjustFontFallback: false", () => {
    const call = fonts.slice(fonts.indexOf("export const bootzy = localFont({"), fonts.indexOf("});", fonts.indexOf("export const bootzy")));
    expect(call).toContain('variable: "--font-bootzy"');
    expect(call).toContain('src: [{ path: "./fonts/bootzy/Bootzy-Regular.woff2", weight: "400", style: "normal" }]');
    expect(call).toContain("adjustFontFallback: false");
    expect(call).toContain("preload: true");
    expect(call).toContain('display: "swap"');
  });

  it("puts its variable on <html> with the other faces", () => {
    expect(layout).toContain("${bootzy.variable} ${instrument.variable} ${plexMono.variable}");
  });

  it("ends the display stack in Instrument Sans, and never synthesises a bold", () => {
    expect(css).toContain("--face-display: var(--font-bootzy), var(--face-sans);");
    expect(css).toMatch(/--face-sans: var\(--font-instrument\),/);
    expect(css).toMatch(/@utility font-display \{[^}]*font-synthesis-weight: none;/);
  });

  it("retires the dotted face: no Instrument Sans Dots files, loader, tokens or DottedLine", () => {
    expect(existsSync(path.join(root, "app/fonts/instrument-sans-dots"))).toBe(false);
    expect(existsSync(path.join(root, "scripts/build-dotted-font.py"))).toBe(false);
    expect(existsSync(path.join(root, "components/brand/DottedLine.tsx"))).toBe(false);
    for (const file of [fonts, layout, css]) expect(file).not.toMatch(/instrumentDots|instrument-sans-dots|--face-dots/);
  });
});

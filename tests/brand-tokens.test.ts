import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_THEME_COLOR, DOOR_THEME_COLOR } from "@/lib/pwa/theme";

/**
 * Review gate for Brand Direction One (docs/design/brand-direction-one.md
 * §2, §3 and §9). It replaces tests/phone-home-tokens.test.ts: rounded-card,
 * rounded-badge and bg-card are site-wide by design now, so what's gated is
 * the brand values themselves, where orange may appear, and the retired
 * colours and faces.
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const css = read("app/globals.css");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}
const sources = ["components", "app", "lib"]
  .flatMap((dir) => sourceFiles(path.join(root, dir)))
  .filter((file) => !file.endsWith("globals.css"))
  .map((file) => ({ file: path.relative(root, file), text: readFileSync(file, "utf8") }));

/** The body of the first rule whose selector is exactly `selector`. */
function block(selector: string) {
  const escaped = selector.replace(/[[\]"().*]/g, "\\$&");
  return css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

describe("brand colour tokens", () => {
  it("puts the four brand colours in :root, in lowercase hex", () => {
    const rootBlock = block(":root");
    expect(rootBlock).toContain("--background: #fffae7;");
    expect(rootBlock).toContain("--foreground: #000000;");
    expect(rootBlock).toContain("--card: #ffffff;");
    expect(rootBlock).toContain("--signal: #ff4800;");
    expect(rootBlock).toContain("--signal-foreground: #000000;");
    // Accent stays black: orange text links would fail contrast on cream (3.25:1).
    expect(rootBlock).toContain("--accent: #000000;");
    for (const hex of css.match(/#[0-9a-fA-F]{6}\b/g) ?? []) expect(hex).toBe(hex.toLowerCase());
  });

  it("keeps :root first, so the first --background is cream and matches the app theme colour", () => {
    expect(css.indexOf(":root")).toBeLessThan(css.indexOf("[data-"));
    expect(css.match(/--background:\s*(#[0-9a-f]{6})/)?.[1]).toBe("#fffae7");
    expect(APP_THEME_COLOR).toBe("#fffae7");
  });

  it("defines the ink and signal section scopes, with readable muted text in each", () => {
    const ink = block('[data-surface="ink"]');
    expect(ink).toContain("--background: #000000;");
    expect(ink).toContain("--foreground: #fffae7;");
    expect(ink).toContain("--muted: #a39e93;"); // 7.87:1 on black
    const signal = block('[data-surface="signal"]');
    expect(signal).toContain("--background: #ff4800;");
    expect(signal).toContain("--foreground: #000000;");
    expect(signal).toContain("--muted: #000000;"); // no grey on orange
  });

  it("leaves the door's ink scope on its own status-bar colour", () => {
    expect(block("[data-door]")).toContain(`--background: ${DOOR_THEME_COLOR};`);
  });

  it("exposes the new colours to Tailwind", () => {
    for (const name of ["signal", "signal-foreground", "ink", "cream", "card"]) {
      expect(css).toContain(`--color-${name}: var(--${name});`);
    }
  });

  it("retires the per-category map colours (category stays in text, never colour)", () => {
    expect(css).not.toMatch(/--cat-/);
    expect(sources.filter(({ text }) => /\b(?:bg|text|ring|border)-cat-/.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it("never draws the focus ring in orange", () => {
    expect(css).toMatch(/:focus-visible\s*\{\s*outline: 2px solid var\(--foreground\);/);
  });

  it("makes shapes rounded squares and shadows flat", () => {
    expect(css).toContain("--radius-control: 0.5rem;");
    expect(css).toContain("--radius-card: 0.75rem;");
    expect(css).toContain("--radius-badge: 0.25rem;");
    expect(css).toContain("--shadow-card: 0 0 #0000;");
    expect(css).not.toMatch(/border-radius:\s*9999px/);
  });
});

describe("Signal Orange text", () => {
  // Orange on cream or white is 3.25–3.40:1: display sizes and marks only (§2.2).
  const SMALL_TEXT = /\b(?:text-(?:xs|sm|base)|eyebrow|meta)\b/;
  const classStrings = sources.flatMap(({ file, text }) =>
    [...text.matchAll(/(["'`])((?:(?!\1)[^\n])*)\1/g)]
      .map((match) => match[2])
      .filter((value) => /\btext-signal(?![-\w])/.test(value))
      .map((value) => ({ file, value })),
  );

  it("is used (so this check is actually looking)", () => {
    expect(classStrings.length).toBeGreaterThan(0);
  });

  it("never sits in a className with small-text classes", () => {
    expect(classStrings.filter(({ value }) => SMALL_TEXT.test(value))).toEqual([]);
  });
});

describe("retired accents (transitional, brand-direction-one.md §9)", () => {
  // Increment 1 turns --highlight and --pop into aliases of --signal. Until the home
  // increment replaces them, their classes and shadow-card stay on the home only.
  const LEGACY = /\b(?:shadow-card|(?:bg|text|ring|border|from|via|to|fill|stroke|outline|decoration)-(?:pop|highlight))\b(?![-\w])/;
  const ALLOWED = [
    path.join("components", "home") + path.sep,
    path.join("components", "HomeSections.tsx"),
    path.join("components", "IntentHero.tsx"),
    path.join("components", "ui", "Sticker.tsx"),
  ];
  const matching = sources.filter(({ text }) => LEGACY.test(text)).map(({ file }) => file);

  it("are aliases of Signal Orange, not their old yellow and pink", () => {
    expect(block(":root")).toContain("--highlight: var(--signal);");
    expect(block(":root")).toContain("--pop: var(--signal);");
    expect(css).not.toMatch(/#e8ff3a|#ff4fb0/);
  });

  it("appear only on the home until its redesign", () => {
    expect(matching.filter((file) => !ALLOWED.some((allowed) => file.startsWith(allowed)))).toEqual([]);
  });
});

describe("brand faces", () => {
  const layout = read("app/layout.tsx");
  const fonts = read("app/fonts.ts");

  it("loads Instrument Sans and IBM Plex Mono, and no longer Bricolage Grotesque or Inter", () => {
    expect(fonts).toMatch(/import \{ IBM_Plex_Mono, Instrument_Sans \} from "next\/font\/google";/);
    expect(layout).toContain("${instrument.variable} ${plexMono.variable}");
    for (const file of [layout, fonts]) {
      expect(file).not.toMatch(/Bricolage|\bInter\b/);
    }
  });

  it("maps the faces to tokens, with the display token falling back to Instrument Sans until Bootzy is licensed", () => {
    expect(css).toMatch(/--face-sans: var\(--font-instrument\),/);
    expect(css).toMatch(/--face-mono: var\(--font-plex-mono\),/);
    expect(css).toContain("--face-display: var(--face-sans);");
    expect(css).toContain("--font-sans: var(--face-sans);");
    expect(css).toContain("--font-mono: var(--face-mono);");
    // The old theme keys pointed at next/font variables of the same name.
    expect(css).not.toMatch(/--font-(?:display|heading|body):/);
  });
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_BACKGROUND_COLOR, APP_THEME_COLOR, DOOR_THEME_COLOR } from "@/lib/pwa/theme";

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
    expect(rootBlock).toContain("--background: #ffffff;");
    expect(rootBlock).toContain("--foreground: #000000;");
    expect(rootBlock).toContain("--card: #ffffff;");
    expect(rootBlock).toContain("--signal: #ff4800;");
    expect(rootBlock).toContain("--signal-foreground: #000000;");
    // Accent stays black: orange text links would fail contrast on white (3.40:1).
    expect(rootBlock).toContain("--accent: #000000;");
    // The redesign's neutrals (the rules' Colour board, "Light and dark"): surface/muted,
    // border/subtle, text/secondary, surface/card-hover (cream) and text/disabled.
    expect(rootBlock).toContain("--surface: #f2f1ee;");
    expect(rootBlock).toContain("--surface-border: #e5e3de;");
    expect(rootBlock).toContain("--muted: #5c5c5c;");
    expect(rootBlock).toContain("--hover: #fffae7;");
    expect(rootBlock).toContain("--disabled: #a3a3a3;");
    for (const hex of css.match(/#[0-9a-fA-F]{6}\b/g) ?? []) expect(hex).toBe(hex.toLowerCase());
  });

  it("keeps :root first, so the first --background is white and matches the app's splash colour", () => {
    expect(css.indexOf(":root")).toBeLessThan(css.indexOf("[data-"));
    expect(css.match(/--background:\s*(#[0-9a-f]{6})/)?.[1]).toBe("#ffffff");
    expect(APP_BACKGROUND_COLOR).toBe("#ffffff");
  });

  it("makes the browser's theme colour the black header's: the ink scope's --background, in both themes", () => {
    const ink = css.slice(css.indexOf('[data-surface="ink"] {'));
    expect(ink.match(/--background:\s*(#[0-9a-f]{6})/)?.[1]).toBe(APP_THEME_COLOR);
    expect(APP_THEME_COLOR).toBe("#000000");
  });

  it("retires the --cream token: white is the foundation, and --paper is the constant white", () => {
    expect(css).not.toMatch(/--cream\b/);
    expect(css).not.toMatch(/--color-cream\b/);
    expect(block(":root")).toContain("--paper: #ffffff;");
    for (const { file, text } of sources) expect(text, file).not.toMatch(/\b(?:bg|text|ring|border|outline|fill|stroke|ring-offset)-cream\b/);
  });

  it("defines the ink and signal section scopes, with readable muted text in each", () => {
    const ink = block('[data-surface="ink"]');
    expect(ink).toContain("--background: #000000;");
    expect(ink).toContain("--foreground: #ffffff;");
    expect(ink).toContain("--accent: #ffffff;");
    expect(ink).toContain("--accent-strong: #e0e0e0;"); // visible hover on the white solid button
    expect(ink).toContain("--muted: #a3a3a3;"); // 8.33:1 on black
    // Ink takes Dark's values, cream hover included.
    expect(ink).toContain("--surface: #1f1f1f;");
    expect(ink).toContain("--hover: #1a1a1a;");
    const signal = block('[data-surface="signal"]');
    expect(signal).toContain("--background: #ff4800;");
    expect(signal).toContain("--foreground: #000000;");
    expect(signal).toContain("--muted: #000000;"); // no grey on orange
  });

  it("leaves the door's ink scope on its own status-bar colour", () => {
    expect(block("[data-door]")).toContain(`--background: ${DOOR_THEME_COLOR};`);
  });

  it("exposes the new colours to Tailwind", () => {
    for (const name of ["signal", "signal-foreground", "ink", "paper", "card", "hover", "disabled"]) {
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

  // The rules' Shape board: two radii, 8 for what you tap (and tags), 16 for what you look at.
  it("makes shapes rounded squares on two radii, and shadows flat", () => {
    expect(css).toContain("--radius-control: 0.5rem;");
    expect(css).toContain("--radius-card: 1rem;");
    expect(css).toContain("--radius-badge: 0.5rem;");
    expect(css).toContain("--radius-sheet: 1rem;");
    expect(css).toContain("--radius-dot: 0.5rem;");
    // No 4, 12, 18 or 24px radius among the tokens.
    expect(css).not.toMatch(/--radius-[\w-]+: (?:0\.25rem|0\.75rem|1\.125rem|1\.5rem);/);
    // The 1.5px control stroke, on fields and buttons.
    expect(css).toContain("--stroke-control: 1.5px;");
    expect(css).toMatch(/@utility border-control \{\s*border-style: solid;\s*border-width: var\(--stroke-control\);/);
    // No shadows: the transitional flat shadow-card token is gone too. The one exception in this
    // file is the open dropdown list (the owner's request, Nov 2026), and only on the --shadow-soft
    // token: never a raw shadow.
    expect(css).not.toMatch(/--shadow-card|box-shadow:(?!\s*var\(--shadow-soft\);)/);
    expect(css.match(/box-shadow:/g) ?? []).toHaveLength(1);
    expect(css).not.toMatch(/border-radius:\s*9999px/);
  });
});

/** The Light colour tokens a scope can carry, in :root's order. */
const COLOUR_TOKENS = [
  "--background",
  "--card",
  "--surface",
  "--surface-border",
  "--foreground",
  "--muted",
  "--hover",
  "--disabled",
  "--accent",
  "--accent-strong",
  "--accent-foreground",
  "--danger",
  "--danger-foreground",
];

/** `name: value` pairs declared in a block body. */
function declarations(body: string): Map<string, string> {
  return new Map([...body.matchAll(/(--[\w-]+|color-scheme):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

describe("the Dark theme and the paper scope (docs/design/theme-white-dark.md §2)", () => {
  // Dark sits inside @media screen, so printed tickets always use the Light tokens.
  const dark = css.match(/@media screen \{\s*\[data-theme="dark"\] \{([^}]*)\}\s*\}/)?.[1] ?? "";

  it("defines Dark on <html>, for screens only, with its own colour scheme and the spec's values", () => {
    const values = declarations(dark);
    expect(values.get("color-scheme")).toBe("dark");
    expect(Object.fromEntries(values)).toMatchObject({
      "--background": "#000000",
      "--card": "#141414",
      "--surface": "#1f1f1f",
      "--surface-border": "#333333",
      "--foreground": "#ffffff",
      "--muted": "#a3a3a3",
      "--hover": "#1a1a1a",
      "--disabled": "#5c5c5c",
      "--accent": "#ffffff",
      "--accent-strong": "#e0e0e0",
      "--accent-foreground": "#000000",
      "--danger": "#ff6b5e",
      "--danger-foreground": "#000000",
    });
    // Orange, ink, paper and the door are constants: Dark never re-scopes them.
    for (const constant of ["--signal", "--signal-foreground", "--ink", "--paper"]) expect(values.has(constant)).toBe(false);
    expect([...values.keys()].some((name) => name.startsWith("--door-"))).toBe(false);
  });

  it("puts Dark after :root (the first --background stays white)", () => {
    expect(css.indexOf("\n:root {")).toBeLessThan(css.indexOf('[data-theme="dark"]'));
  });

  it("has a screen-only dark: variant for Tailwind", () => {
    expect(css).toMatch(
      /@custom-variant dark \{\s*@media screen \{\s*&:where\(\[data-theme="dark"\], \[data-theme="dark"\] \*\) \{\s*@slot;/,
    );
  });

  it("pins a paper subtree to the Light colour tokens, token for token", () => {
    const root = declarations(block(":root"));
    const paper = declarations(block('[data-surface="paper"]'));
    for (const name of COLOUR_TOKENS) expect(paper.get(name), name).toBe(root.get(name));
    expect(paper.get("color-scheme")).toBe("light");
  });

  it("keeps the orange band's card and surface light in both themes", () => {
    const signal = declarations(block('[data-surface="signal"]'));
    expect(signal.get("--card")).toBe("#ffffff");
    expect(signal.get("--surface")).toBe(declarations(block(":root")).get("--surface"));
    expect(signal.get("--accent-foreground")).toBe("#ffffff");
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

describe("retired accents and motion (brand-direction-one.md §9, cleanup)", () => {
  // The home redesign removed the last users of the transitional pink/yellow aliases and the
  // sticker graphics, so the aliases, their classes and the perpetual motion are gone everywhere.
  const LEGACY = /\b(?:shadow-card|(?:bg|text|ring|border|from|via|to|fill|stroke|outline|decoration)-(?:pop|highlight))\b(?![-\w])/;

  it("no longer defines the --highlight and --pop aliases, or their old yellow and pink", () => {
    expect(css).not.toMatch(/--(?:highlight|pop|color-highlight|color-pop):/);
    expect(css).not.toMatch(/#e8ff3a|#ff4fb0/);
  });

  it("are used nowhere", () => {
    expect(sources.filter(({ text }) => LEGACY.test(text)).map(({ file }) => file)).toEqual([]);
  });

  it("has no looping decorative motion: no float, slow spin or marquee", () => {
    expect(css).not.toMatch(/\.float\b|spin-slow|@keyframes marquee/);
    const looping = /className=["'`{][^"'`]*(?:\bfloat\b|\bspin-slow\b|animate-\[spin)/;
    expect(sources.filter(({ text }) => looping.test(text)).map(({ file }) => file)).toEqual([]);
  });

  // The one exception, at the owner's request (23 Oct 2026): the desktop hero collage's round badge
  // turns, slowly, only for people who haven't asked for less motion, and it can be paused
  // (tests/HeroCollage.test.tsx covers the control).
  it("allows one looping turn, the hero badge's: motion-safe, slow and nowhere else", () => {
    const spinning = sources.filter(({ text }) => /\banimate-spin\b/.test(text));
    expect(spinning.map(({ file }) => file)).toEqual([path.join("components", "home", "HeroBadge.tsx")]);
    const badge = spinning[0]?.text ?? "";
    expect(badge).toMatch(/motion-safe:animate-spin/);
    expect(badge).not.toMatch(/(?<!motion-safe:)\banimate-spin\b/);
    expect(badge).toMatch(/HERO_BADGE_TURN = "30s"/);
  });

  // The second, at the owner's request (23 Oct 2026, "make them automatically scroll"), now the home's
  // featured carousel (redesign PR 3; the rails and their marquee are gone): one slide at a time,
  // advanced by one shared interval, only for people who haven't asked for less motion, with a
  // Pause/Play button (tests/FeaturedCarousel.test.tsx covers the behaviour).
  it("allows one auto-advance, the home carousel's: motion-gated, with a Pause/Play control, and no marquee anywhere", () => {
    const carousel = sources.find(({ file }) => file === path.join("components", "home", "FeaturedCarousel.tsx"))?.text ?? "";
    expect(carousel).toMatch(/useMotionOk\(\)/);
    expect(carousel).toMatch(/const moving = motionOk && playing/);
    expect(carousel).toMatch(/useVisibleInterval\(/);
    expect(carousel).toMatch(/aria-label=\{playing \? "Pause carousel" : "Play carousel"\}/);
    // The only script that advances anything by itself on the home.
    const advancing = sources.filter(({ text }) => /\buseVisibleInterval\(\(\) => goTo\(/.test(text)).map(({ file }) => file);
    expect(advancing).toEqual([path.join("components", "home", "FeaturedCarousel.tsx")]);
    // The marquee's hook and its copies are gone.
    expect(sources.filter(({ text }) => /\buseRailAutoScroll\(|data-rail-clone=""|<RailCloneSet\b/.test(text)).map(({ file }) => file)).toEqual([]);
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

  it("maps the faces to tokens: Bootzy for display, falling back to Instrument Sans, at weight 400", () => {
    expect(css).toMatch(/--face-sans: var\(--font-instrument\),/);
    expect(css).toMatch(/--face-mono: var\(--font-plex-mono\),/);
    expect(css).toContain("--face-display: var(--font-bootzy), var(--face-sans);");
    expect(css).toContain("--display-weight: 400;");
    // The dotted face is retired everywhere.
    expect(css).not.toMatch(/--face-dots|--font-instrument-dots|font-dots|display-plain/);
    expect(css).toContain("--font-sans: var(--face-sans);");
    expect(css).toContain("--font-mono: var(--face-mono);");
    // The old theme keys pointed at next/font variables of the same name.
    expect(css).not.toMatch(/--font-(?:display|heading|body):/);
  });
});

describe("buttons (the rules' Buttons board)", () => {
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };

  it("is Label/Button 16/24 in sentence case at every size: S 40, M 48, L 56", () => {
    const btn = rule("  .btn");
    expect(btn).toContain("min-height: 3rem;");
    expect(btn).toContain("font-size: 1rem;");
    expect(btn).toContain("line-height: 1.5rem;");
    expect(btn).toContain("text-transform: none;");
    expect(rule("  .btn-sm")).toContain("min-height: 2.5rem;");
    expect(rule("  .btn-sm")).not.toMatch(/font-size|line-height/);
    expect(rule("  .btn-lg")).toContain("min-height: 3.5rem;");
    expect(rule("  .btn-lg")).not.toMatch(/font-size|line-height/);
  });

  it("keeps the primary's orange edge on hover and press (black fill, orange label)", () => {
    expect(css).toMatch(/\.btn-signal:hover:not\(:disabled, \[aria-disabled="true"\]\) \{\s*background: var\(--ink\);\s*border-color: var\(--signal\);\s*color: var\(--signal\);/);
    expect(css).toMatch(/\.btn-signal:active:not\(:disabled, \[aria-disabled="true"\]\) \{\s*background: var\(--ink\);\s*border-color: var\(--signal\);\s*color: var\(--signal\);/);
  });

  it("greys a disabled button's label (text/disabled) but keeps a busy one's readable (--muted)", () => {
    expect(css).toMatch(/\.btn:disabled,\s*\.btn\[aria-disabled="true"\] \{[^}]*color: var\(--muted\);/);
    expect(css).toMatch(/\.btn:disabled \{\s*color: var\(--disabled\);\s*\}/);
  });
});

describe("current page in the nav", () => {
  // The rules' Navigation board: orange dots under the pointer as well as on the current page.
  it("turns the dots orange on hover, not black", () => {
    const umlaut = css.slice(css.indexOf("@utility umlaut {"), css.indexOf("@utility umlaut-lg"));
    expect(umlaut).toMatch(/@media \(hover: hover\) \{\s*&:hover,\s*\[role="tab"\]:hover > & \{\s*--umlaut: var\(--signal\);/);
  });

  it("marks it with a 2px underline as well as the orange dots (not colour and small marks alone)", () => {
    const umlaut = css.slice(css.indexOf("@utility umlaut {"), css.indexOf("@utility umlaut-lg"));
    // The page, and the section you're in (aria-current="true": Discover on an event's page).
    const current = umlaut.match(/&\[aria-current="page"\],\s*&\[aria-current="true"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(current).toContain("--umlaut: var(--signal);");
    // Underlined unless a nav button turns it off: it fills instead (below).
    expect(current).toContain("text-decoration-line: var(--umlaut-line, underline);");
    expect(current).toContain("text-decoration-thickness: 2px;");
  });

  // The header's nav button ("For organisers", "Messages"): the dots above it, and the fill marks the page.
  it("the nav button lifts its dots above the button, fills when current, and only the header's buttons drop the underline", () => {
    const block = (name: string) => {
      const start = css.indexOf(`@utility ${name} {`);
      return css.slice(start, css.indexOf("\n@utility ", start + 1));
    };
    const button = block("nav-button");
    // The rules' Navigation board: Label/Nav 18 medium, 24px sides, 40px, the stroke, radius 8.
    expect(button).toContain("font-size: 1.125rem;");
    expect(button).toContain("font-weight: 500;");
    expect(button).toContain("padding-inline: 1.5rem;");
    expect(button).toContain("min-height: 2.5rem;");
    expect(button).toContain("border: var(--stroke-control) solid var(--foreground);");
    expect(button).toContain("border-radius: var(--radius-control);");
    // The 20×6 dots, 8px above the button.
    expect(button).toContain("--umlaut-w: 20px;");
    expect(button).toContain("--umlaut-h: 6px;");
    expect(button).toContain("--umlaut-top: -0.875rem;");
    expect(button).toContain("--umlaut-line: none;");
    expect(button).toMatch(/&\[aria-current="page"\] \{\s*background: var\(--foreground\);\s*color: var\(--background\);/);
    // The Messages chip: 32px, 14px, a muted outline.
    const chip = block("nav-chip");
    expect(chip).toContain("height: 2rem;");
    expect(chip).toContain("font-size: 0.875rem;");
    expect(chip).toContain("border: var(--stroke-control) solid var(--surface-border);");
    // The nav items: the same 20×6 dots, the underline 12px under the label.
    const item = block("umlaut-nav");
    expect(item).toContain("--umlaut-w: 20px;");
    expect(item).toContain("--umlaut-h: 6px;");
    expect(item).toContain("--umlaut-offset: 12px;");
    // Only the header's button, chip and avatar fill instead of underlining.
    expect(css.match(/--umlaut-line: none;/g)).toHaveLength(3);
  });

  it("the desktop header is 96px from lg, 64px below", () => {
    expect(css).toMatch(/--header-h: 4rem;/);
    expect(css).toMatch(/@media \(width >= 64rem\) \{\s*:root \{\s*--header-h: 6rem;/);
  });
});

describe("the type scale (the rules' Type board)", () => {
  /** A utility's whole block, up to the next top-level @utility. */
  const utility = (name: string) => {
    const start = css.indexOf(`@utility ${name} {`);
    const next = css.indexOf("\n@utility ", start + 1);
    return start < 0 ? "" : css.slice(start, next < 0 ? undefined : next);
  };

  it("defines the fifteen styles", () => {
    const styles = [
      "display-xl", "display-l", "display-m",
      "heading-h1", "heading-h2", "heading-h3", "heading-h4",
      "body-l", "body-m", "body-s",
      "label-nav", "label-button", "label-tag",
      "mono-m", "mono-s",
    ];
    for (const name of styles) expect(utility(name), name).not.toBe("");
  });

  it.each([
    ["display-xl", "3.5rem", "4rem", "6rem", "6rem"],
    ["display-l", "3rem", "3.5rem", "4.5rem", "5rem"],
    ["display-m", "2.5rem", "3rem", "3.5rem", "4rem"],
    ["heading-h1", "2rem", "2.5rem", "2.5rem", "3rem"],
    ["heading-h2", "1.75rem", "2.25rem", "2rem", "2.5rem"],
    ["heading-h3", "1.25rem", "1.75rem", "1.5rem", "2rem"],
    ["heading-h4", "1.125rem", "1.5rem", "1.25rem", "1.75rem"],
    ["body-l", "1rem", "1.5rem", "1.125rem", "1.75rem"],
  ])("%s: %s/%s below 768px, %s/%s from 768px", (name, size, leading, desktopSize, desktopLeading) => {
    expect(utility(name)).toMatch(
      new RegExp(
        `font-size: ${size};\\s*line-height: ${leading};\\s*@media \\(width >= 48rem\\) \\{\\s*font-size: ${desktopSize};\\s*line-height: ${desktopLeading};`,
      ),
    );
  });

  it("sets the display styles (and title-lg, an event's title) in Bootzy capitals at 400 with no synthesised bold", () => {
    for (const name of ["display-xl", "display-l", "display-m", "title-lg", "font-display"]) {
      const body = utility(name);
      expect(body, name).toContain("font-family: var(--face-display);");
      expect(body, name).toContain("font-weight: var(--display-weight);");
      expect(body, name).toContain("font-synthesis-weight: none;");
      if (name !== "font-display") expect(body, name).toContain("text-transform: uppercase;");
    }
  });

  it("keeps headings, body, labels and mono in sentence case (capitals are display's and the eyebrow's only)", () => {
    const sentenceCase = [
      "heading-h1", "heading-h2", "heading-h3", "heading-h4",
      "body-l", "body-m", "body-s", "label-nav", "label-tag", "mono-m", "mono-s",
      "display-lg", "display-md", "meta",
    ];
    for (const name of sentenceCase) expect(utility(name), name).not.toContain("uppercase");
    // A button's label is sentence case ("Buy tickets", never "BUY TICKETS").
    expect(utility("label-button")).toContain("text-transform: none;");
    const headings = css.slice(css.indexOf("h1,\nh2,\nh3,\nh4 {"), css.indexOf("}", css.indexOf("h1,\nh2,\nh3,\nh4 {")));
    expect(headings).toContain("font-weight: 700;");
    expect(headings).not.toContain("uppercase");
    expect(utility("eyebrow")).toContain("text-transform: uppercase;");
    expect(utility("eyebrow")).toContain("letter-spacing: 0.02em;");
  });

  it("points the old names at the new styles: display-lg is heading-h1, display-md heading-h3, title-lg display-m", () => {
    const body = (name: string) =>
      utility(name)
        .replace(/@utility [\w-]+ \{/, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();
    expect(body("display-lg")).toBe(body("heading-h1"));
    expect(body("display-md")).toBe(body("heading-h3"));
    expect(body("title-lg")).toBe(body("display-m"));
  });

  it("reaches the display face only through the display styles and font-display", () => {
    for (const { file, text } of sources) expect(text, file).not.toMatch(/var\(--font-bootzy\)/);
  });

  // Refinement (22 Oct 2026): the bordered badge was one of the repeated bulky notices. A small "Demo"
  // tag on the soft fill, still black text and still never orange; the page's disclosure is DemoBanner.
  it("keeps the demo labels off the orange: a quiet 'Demo' tag at the booking points, one slim banner per page", () => {
    const notice = sources.find((s) => s.file === path.join("components", "DemoNotice.tsx"));
    expect(notice?.text).toMatch(/bg-surface[^"]*text-foreground/);
    expect(notice?.text).toContain("Demo");
    const banner = sources.find((s) => s.file === path.join("components", "DemoBanner.tsx"));
    expect(banner?.text).toContain("No real bookings.");
    for (const file of [notice, banner]) expect(file?.text).not.toMatch(/bg-signal|text-signal/);
  });

});

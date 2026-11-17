import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rounded dropdown list (app/globals.css, "Dropdown lists"; the owner's request, Nov 2026):
 * the native select's open list as a rounded card, through the customizable select. jsdom can't
 * render a picker, so this pins the rules that keep it safe: only where the browser has
 * base-select, only with a fine pointer (phones keep their own picker), tokens only, and the
 * closed select's own look kept.
 */
const css = readFileSync(path.resolve(import.meta.dirname, "..", "app/globals.css"), "utf8");
const start = css.indexOf("@supports (appearance: base-select)");
const section = start >= 0 ? css.slice(start, css.indexOf("\n}\n", start)) : "";

describe("the rounded dropdown list", () => {
  it("is progressive: only where base-select is supported, and only with a mouse or trackpad", () => {
    expect(start).toBeGreaterThan(-1);
    expect(section).toContain("@media (hover: hover) and (pointer: fine)");
    // Nothing else in the file turns it on.
    expect(css.match(/appearance: base-select;/g)).toHaveLength(1);
    expect(section).toMatch(/select:not\(\[multiple\]\),\s*select:not\(\[multiple\]\)::picker\(select\) \{\s*appearance: base-select;/);
  });

  it("draws the list as a rounded card on the soft shadow, from tokens, opening below the select", () => {
    const picker = section.match(/select:not\(\[multiple\]\)::picker\(select\) \{([^}]*)\}/g)?.[1] ?? "";
    expect(picker).toContain("border-radius: var(--radius-card);");
    expect(picker).toContain("background-color: var(--card);");
    expect(picker).toContain("color: var(--foreground);");
    expect(picker).toContain("box-shadow: var(--shadow-soft);");
    expect(picker).toContain("padding: 0.5rem;");
    expect(picker).toContain("text-transform: none;");
    expect(picker).toContain("position-try-order: normal;");
    expect(picker).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it("has 40px rows, cream under the pointer or keyboard, and the check at the right", () => {
    expect(section).toMatch(/option \{[^}]*min-block-size: 2\.5rem;[^}]*border-radius: var\(--radius-control\);/);
    expect(section).toMatch(/option:hover,\s*select:not\(\[multiple\]\) option:focus-visible \{\s*background-color: var\(--hover\);/);
    expect(section).toMatch(/option::checkmark \{\s*order: 1;\s*margin-inline-start: auto;/);
  });

  it("keeps the closed select's own look: its own chevron, height and leading still win", () => {
    expect(section).toMatch(/select\.appearance-none::picker-icon \{\s*display: none;/);
    // In the base layer, so a select's min-h-* and text utilities override it.
    expect(section).toMatch(/@layer base \{\s*select:not\(\[multiple\]\) \{\s*align-items: center;\s*min-block-size: auto;\s*line-height: normal;/);
  });
});

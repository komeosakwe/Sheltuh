import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOOR_THEME_COLOR } from "@/lib/pwa/theme";

/**
 * Review gate from docs/design/check-in.md §2.1: the door's ink scope and its
 * green, red and amber fills belong to the door scanner only. They may appear
 * only under components/check-in/ and the check-in route.
 */
const DOOR_ONLY = /\bdata-door\b|--door-|\b(?:bg|text|ring|border|from|via|to|fill|stroke|outline|decoration|divide|shadow)-door-/;
const ALLOWED = [
  path.join("components", "check-in") + path.sep,
  path.join("app", "dashboard", "[eventId]", "check-in") + path.sep,
];

const root = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

const files = ["components", "app", "lib"].flatMap((dir) => sourceFiles(path.join(root, dir)));
const matching = files
  .filter((file) => !file.endsWith("globals.css"))
  .filter((file) => DOOR_ONLY.test(readFileSync(file, "utf8")))
  .map((file) => path.relative(root, file));
const css = readFileSync(path.join(root, "app", "globals.css"), "utf8");

describe("door-only tokens", () => {
  it("are used by the door scanner (so this check is actually looking)", () => {
    expect(matching.some((file) => file.startsWith(ALLOWED[0]))).toBe(true);
  });

  it("appear nowhere else", () => {
    expect(matching.filter((file) => !ALLOWED.some((allowed) => file.startsWith(allowed)))).toEqual([]);
  });

  it("are defined, with a Tailwind colour for each fill and its text pair", () => {
    for (const name of ["admit", "refuse", "hold"]) {
      expect(css).toMatch(new RegExp(`--door-${name}: #[0-9a-f]{6};`));
      expect(css).toMatch(new RegExp(`--door-${name}-foreground: #[0-9a-f]{6};`));
      expect(css).toContain(`--color-door-${name}: var(--door-${name});`);
      expect(css).toContain(`--color-door-${name}-foreground: var(--door-${name}-foreground);`);
    }
  });

  it("give the door an ink background matching its status-bar colour", () => {
    const scope = css.match(/\[data-door\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(scope).toContain("color-scheme: dark;");
    expect(scope).toContain(`--background: ${DOOR_THEME_COLOR};`);
    // Paper-scope muted is only 3.5:1 on ink: the door needs its own.
    expect(scope).toMatch(/--muted: #[0-9a-f]{6};/);
  });
});

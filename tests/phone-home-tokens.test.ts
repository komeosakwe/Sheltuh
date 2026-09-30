import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Review gate from docs/design/mobile-home.md §2: the soft card shapes and the
 * pink/card colours belong to the phone home only. Everything else stays
 * square and flat, so these classes may appear only under components/home/phone/
 * (and Sticker.tsx, home of the Scribble).
 */
const PHONE_ONLY = /\b(?:rounded-(?:card|badge)|shadow-card|(?:bg|text|ring|border|from|via|to|fill|stroke|outline|decoration)-(?:card|pop))\b(?![-\w])/;
const ALLOWED = [path.join("components", "home", "phone") + path.sep, path.join("components", "ui", "Sticker.tsx")];

const root = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

const files = ["components", "app"].flatMap((dir) => sourceFiles(path.join(root, dir)));
const matching = files
  .filter((file) => !file.endsWith("globals.css"))
  .filter((file) => PHONE_ONLY.test(readFileSync(file, "utf8")))
  .map((file) => path.relative(root, file));

describe("phone-home-only tokens", () => {
  it("are used by the phone home (so this check is actually looking)", () => {
    expect(matching.some((file) => file.startsWith(ALLOWED[0]))).toBe(true);
  });

  it("appear nowhere else", () => {
    expect(matching.filter((file) => !ALLOWED.some((allowed) => file.startsWith(allowed)))).toEqual([]);
  });
});

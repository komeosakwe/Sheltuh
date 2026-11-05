import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No migration may contain an invisible (Unicode format, Cf), line-separator
 * (Zl) or paragraph-separator (Zp) character, typed raw. They are lost or
 * altered when SQL is pasted into the Supabase SQL Editor (the way these files
 * are run), which can silently change or break a regular expression: write
 * them as escapes (\uXXXX / \UXXXXXXXX inside a regex) instead.
 */
const DIR = path.resolve(import.meta.dirname, "../../supabase/migrations");
const INVISIBLE = /[\p{Cf}\p{Zl}\p{Zp}]/u;

describe("supabase/migrations", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sql"));

  it("has migrations to check", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("holds no raw invisible, line-separator or paragraph-separator characters", () => {
    const found: string[] = [];
    for (const file of files) {
      readFileSync(path.join(DIR, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          const hit = [...line].find((c) => INVISIBLE.test(c));
          if (hit) found.push(`${file}:${i + 1} U+${hit.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("the check itself catches each kind", () => {
    for (const cp of [0xad, 0x200b, 0x200f, 0x2028, 0x2029, 0x202e, 0x2060, 0x2064, 0xfeff]) {
      expect(INVISIBLE.test(`select '${String.fromCodePoint(cp)}'`), cp.toString(16)).toBe(true);
    }
    expect(INVISIBLE.test("select 'plain ascii and é, ü, 日本'")).toBe(false);
  });
});

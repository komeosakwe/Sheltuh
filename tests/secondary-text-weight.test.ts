import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Secondary text (the owner's option B, Nov 2026): muted text at reading size and the fields'
 * placeholders are Instrument Sans Medium (500) in --muted; smaller muted text stays 400.
 */
const css = readFileSync(path.resolve(import.meta.dirname, "..", "app/globals.css"), "utf8");

describe("secondary text weight", () => {
  it("makes placeholders Medium, in the muted colour", () => {
    expect(css).toMatch(/input::placeholder,\s*textarea::placeholder \{\s*color: var\(--muted\);\s*font-weight: 500;/);
  });

  it("makes reading-size muted text Medium, unless the element sets its own weight", () => {
    expect(css).toMatch(
      /\.text-muted:is\(\.body-l, \.body-m, \.text-base, \.text-lg\):not\(\.font-normal, \.font-semibold, \.font-bold\) \{\s*font-weight: 500;\s*\}/,
    );
  });

  it("leaves small muted text and the mono eyebrows alone", () => {
    expect(css).not.toMatch(/\.text-muted[^{]*\.(?:text-sm|text-xs|body-s|eyebrow)\b[^{]*\{\s*font-weight: 500;/);
  });
});

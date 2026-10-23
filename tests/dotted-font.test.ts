import { readFileSync } from "node:fs";
import path from "node:path";
import { brotliDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";

/**
 * The dotted vowels (owner, 23 Oct 2026): every vowel on the site is drawn
 * with the brand's two dots, in the font only (app/fonts/instrument-sans-dots/
 * README.md). This reads the committed woff2 with a small WOFF2 parser (node's
 * brotli, no font library at test time) and checks the CSS wiring: dotted
 * sans first, plain sans for form fields, mono untouched.
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const FONT_DIR = "app/fonts/instrument-sans-dots";
const FONT_FILE = `${FONT_DIR}/InstrumentSansDots-latin.woff2`;

// WOFF2 §5.1: the known-table tags, by their 6-bit index in a directory entry's flags.
const KNOWN_TAGS = (
  "cmap head hhea hmtx maxp name OS/2 post cvt_ fpgm glyf loca prep CFF_ VORG EBDT EBLC gasp hdmx kern LTSH " +
  "PCLT VDMX vhea vmtx BASE GDEF GPOS GSUB EBSC JSTF MATH CBDT CBLC COLR CPAL SVG_ sbix acnt avar bdat bloc " +
  "bsln cvar fdsc feat fmtx fvar gvar hsty just lcar mort morx opbd prop trak Zapf Silf Glat Gloc Feat Sill"
)
  .split(" ")
  .map((tag) => tag.replace("_", " "));

/** The uncompressed sfnt tables of a (non-collection) WOFF2 file, by tag. */
function woff2Tables(file: Buffer): Map<string, Buffer> {
  expect(file.toString("latin1", 0, 4)).toBe("wOF2");
  const numTables = file.readUInt16BE(12);
  const totalCompressedSize = file.readUInt32BE(20);
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      const byte = file[at++];
      value = value * 128 + (byte & 0x7f);
      if ((byte & 0x80) === 0) return value;
    }
    throw new Error("bad UIntBase128");
  };
  const entries: { tag: string; length: number }[] = [];
  for (let i = 0; i < numTables; i++) {
    const flags = file[at++];
    const tagIndex = flags & 0x3f;
    const version = flags >> 6;
    let tag: string;
    if (tagIndex === 63) {
      tag = file.toString("latin1", at, at + 4);
      at += 4;
    } else {
      tag = KNOWN_TAGS[tagIndex];
    }
    const origLength = base128();
    // glyf/loca: version 0 is the transform (3 is none); every other table: 0 is none.
    const transformed = tag === "glyf" || tag === "loca" ? version !== 3 : version !== 0;
    const length = transformed ? base128() : origLength;
    entries.push({ tag, length });
  }
  const stream = brotliDecompressSync(file.subarray(at, at + totalCompressedSize));
  const tables = new Map<string, Buffer>();
  let offset = 0;
  for (const { tag, length } of entries) {
    tables.set(tag, stream.subarray(offset, offset + length));
    offset += length;
  }
  expect(offset).toBe(stream.length);
  return tables;
}

/** A character → glyph-id lookup for each Unicode cmap subtable (formats 4 and 12). */
function unicodeCmaps(cmap: Buffer): ((code: number) => number)[] {
  const lookups: ((code: number) => number)[] = [];
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i++) {
    const platform = cmap.readUInt16BE(4 + i * 8);
    const encoding = cmap.readUInt16BE(6 + i * 8);
    const sub = cmap.readUInt32BE(8 + i * 8);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode) continue;
    const format = cmap.readUInt16BE(sub);
    if (format === 4) {
      const segCount = cmap.readUInt16BE(sub + 6) / 2;
      const ends = sub + 14;
      const starts = ends + segCount * 2 + 2;
      const deltas = starts + segCount * 2;
      const rangeOffsets = deltas + segCount * 2;
      lookups.push((code) => {
        for (let s = 0; s < segCount; s++) {
          if (cmap.readUInt16BE(ends + s * 2) < code) continue;
          const start = cmap.readUInt16BE(starts + s * 2);
          if (start > code) return 0;
          const delta = cmap.readInt16BE(deltas + s * 2);
          const rangeOffset = cmap.readUInt16BE(rangeOffsets + s * 2);
          if (rangeOffset === 0) return (code + delta) & 0xffff;
          const glyph = cmap.readUInt16BE(rangeOffsets + s * 2 + rangeOffset + (code - start) * 2);
          return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
        }
        return 0;
      });
    } else if (format === 12) {
      const groups = cmap.readUInt32BE(sub + 12);
      lookups.push((code) => {
        for (let g = 0; g < groups; g++) {
          const at = sub + 16 + g * 12;
          const start = cmap.readUInt32BE(at);
          if (code >= start && code <= cmap.readUInt32BE(at + 4)) return cmap.readUInt32BE(at + 8) + code - start;
        }
        return 0;
      });
    }
  }
  return lookups;
}

/** Windows-platform (UTF-16BE) name records, by name ID. */
function names(name: Buffer): Map<number, string> {
  const result = new Map<number, string>();
  const count = name.readUInt16BE(2);
  const strings = name.readUInt16BE(4);
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 12;
    if (name.readUInt16BE(at) !== 3) continue;
    const length = name.readUInt16BE(at + 8);
    const offset = strings + name.readUInt16BE(at + 10);
    const utf16be = name.subarray(offset, offset + length);
    result.set(name.readUInt16BE(at + 6), Buffer.from(utf16be).swap16().toString("utf16le"));
  }
  return result;
}

/** fvar axes: tag → [min, default, max]. */
function axes(fvar: Buffer): Map<string, [number, number, number]> {
  const result = new Map<string, [number, number, number]>();
  const first = fvar.readUInt16BE(4);
  const count = fvar.readUInt16BE(8);
  const size = fvar.readUInt16BE(10);
  for (let i = 0; i < count; i++) {
    const at = first + i * size;
    const fixed = (o: number) => fvar.readInt32BE(at + o) / 65536;
    result.set(fvar.toString("latin1", at, at + 4), [fixed(4), fixed(8), fixed(12)]);
  }
  return result;
}

describe("Instrument Sans Dots (the woff2)", () => {
  const tables = woff2Tables(readFileSync(path.join(root, FONT_FILE)));
  const cmaps = unicodeCmaps(tables.get("cmap") ?? Buffer.alloc(0));
  const pairs = [..."aeiouAEIOU"].map((plain, i) => [plain, [..."äëïöüÄËÏÖÜ"][i]] as const);

  it("draws each plain vowel with its diaeresis glyph, in every Unicode cmap subtable", () => {
    expect(cmaps.length).toBeGreaterThan(0);
    for (const glyphOf of cmaps) {
      for (const [plain, dotted] of pairs) {
        const glyph = glyphOf(dotted.codePointAt(0) ?? 0);
        expect(glyph, dotted).toBeGreaterThan(0);
        expect(glyphOf(plain.codePointAt(0) ?? 0), plain).toBe(glyph);
      }
    }
  });

  it("leaves every other letter, digit and the existing accents on their own glyphs", () => {
    for (const glyphOf of cmaps) {
      const dottedGlyphs = new Set(pairs.map(([, dotted]) => glyphOf(dotted.codePointAt(0) ?? 0)));
      // Ten vowels on five + five distinct glyphs: no two vowels collapsed into one.
      expect(dottedGlyphs.size).toBe(10);
      for (const other of "bcdfghjklmnpqrstvwxyzBYZ0129ÿáéÁ") {
        const glyph = glyphOf(other.codePointAt(0) ?? 0);
        expect(glyph, other).toBeGreaterThan(0);
        expect(dottedGlyphs.has(glyph), other).toBe(false);
      }
    }
  });

  it("is renamed (an OFL Modified Version), keeps the copyright and licence, and stays variable 400–700", () => {
    const nameRecords = names(tables.get("name") ?? Buffer.alloc(0));
    expect(nameRecords.get(1)).toBe("Instrument Sans Dots");
    expect(nameRecords.get(6)).toBe("InstrumentSansDots-Regular");
    expect(nameRecords.get(0)).toContain("Copyright 2022 The Instrument Sans Project Authors");
    expect(nameRecords.get(13)).toContain("SIL Open Font License, Version 1.1");
    expect(nameRecords.get(14)).toContain("scripts.sil.org/OFL");
    expect(axes(tables.get("fvar") ?? Buffer.alloc(0)).get("wght")).toEqual([400, 400, 700]);
  });

  it("ships with the OFL text, which declares no Reserved Font Name, and a README saying how it was made", () => {
    const licence = read(`${FONT_DIR}/OFL.txt`);
    expect(licence).toContain("SIL OPEN FONT LICENSE Version 1.1");
    const notice = licence.slice(0, licence.indexOf("-----"));
    expect(notice).toContain("Copyright 2022 The Instrument Sans Project Authors");
    expect(notice).not.toMatch(/Reserved Font Name/i);
    const readme = read(`${FONT_DIR}/README.md`);
    expect(readme).toContain("scripts/build-dotted-font.py");
    expect(readme).toContain("Modified Version");
  });
});

describe("dotted vowels in the CSS", () => {
  const css = read("app/globals.css");
  const fonts = read("app/fonts.ts");
  const layout = read("app/layout.tsx");

  it("loads the dotted face with next/font/local, its @font-face named as its CSS variable says, on <html>", () => {
    expect(fonts).toContain('import localFont from "next/font/local";');
    expect(fonts).toContain('variable: "--font-instrument-dots"');
    expect(fonts).toContain('path: "./fonts/instrument-sans-dots/InstrumentSansDots-latin.woff2", weight: "400 700"');
    // next/font/local names the CSS variable's family after the export: the @font-face must match.
    expect(fonts).toMatch(/export const instrumentDots = localFont\(/);
    expect(fonts).toContain('declarations: [{ prop: "font-family", value: "instrumentDots" }]');
    expect(layout).toContain("${instrumentDots.variable} ${instrument.variable} ${plexMono.variable}");
  });

  it("puts the dotted face first in the sans (so in the display face too), the plain one after it", () => {
    expect(css).toMatch(/--face-sans: var\(--font-instrument-dots\), var\(--font-instrument\), /);
    expect(css).toContain("--face-display: var(--face-sans);");
    expect(css).toContain("--font-sans: var(--face-sans);");
  });

  it("keeps a plain sans for form fields, and the mono plain", () => {
    const plain = css.match(/--face-sans-plain: ([^;]*);/)?.[1] ?? "";
    expect(plain).toMatch(/^var\(--font-instrument\), /);
    expect(plain).not.toContain("dots");
    const mono = css.match(/--face-mono: ([^;]*);/)?.[1] ?? "";
    expect(mono).toMatch(/^var\(--font-plex-mono\), /);
    expect(mono).not.toContain("instrument");
    const fields = css.match(/@layer base \{\s*input,\s*textarea,\s*select,\s*\[contenteditable\]:not\(\[contenteditable="false"\]\) \{([^}]*)\}/);
    expect(fields?.[1]).toContain("font-family: var(--face-sans-plain);");
  });
});

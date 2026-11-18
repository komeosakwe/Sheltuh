import { describe, expect, it } from "vitest";
import {
  centredSquare,
  clearSquare,
  QR_LOGO_CLEAR_MODULES,
  QR_LOGO_MARK_MODULES,
  QR_LOGO_MAX_MODULES,
  QR_QUIET_ZONE_MODULES,
  qrFunctionModules,
  squareHitsFunctionPatterns,
  ticketQrLabel,
  ticketQrMatrix,
  ticketQrSvgPath,
  ticketQrSymbol,
} from "@/lib/ticket-qr";

/*
 * These tests check the symbol against the QR standard (ISO/IEC 18004)
 * structurally, and pin one known-good matrix. That golden matrix (level H,
 * version 2, since the centre ü: docs/design/ticket-email.md §6) decodes to
 * `SH1:7KQM-2HXD` with ZXing, and tests/ticket-qr-decode.test.ts decodes
 * every image the email and the ticket page draw. If the golden test fails,
 * the encoder's output has changed: re-verify it with a decoder before
 * updating it.
 */

const GOLDEN_7KQM_2HXD = [
  "#######...##.#.##.#######",
  "#.....#...#.....#.#.....#",
  "#.###.#...#.#...#.#.###.#",
  "#.###.#..####.##..#.###.#",
  "#.###.#.#.##.#.##.#.###.#",
  "#.....#..#.##.#...#.....#",
  "#######.#.#.#.#.#.#######",
  "........##..##.##........",
  "..##..###.#########.#....",
  "##..#.....#....##.#.##.#.",
  "...##.#.#.##..##.#....###",
  ".#...#.##..#.###.....##..",
  ".###..#######..##.#.....#",
  "..####.#...##.#..#.#.....",
  ".#..#.#.##..#.#..##.##.##",
  "#.##.#..#....###......##.",
  "..#...##..##.#..#####.#.#",
  "........#..#.#..#...###..",
  "#######.##.#.#.##.#.#..#.",
  "#.....#....##.###...##.##",
  "#.###.#..#....#######.##.",
  "#.###.#.######.###..#...#",
  "#.###.#.######.###.#####.",
  "#.....#......####...#.#.#",
  "#######..#.###.#.###..#.#",
];

const toRows = (m: boolean[][]) => m.map((row) => row.map((d) => (d ? "#" : ".")).join(""));

/** The 15 format bits from the copy around the top-left finder (bit 14 first). */
function formatBitsTopLeft(m: boolean[][]): number {
  const bit = (x: number, y: number) => (m[y][x] ? 1 : 0);
  let bits = 0;
  for (let i = 0; i <= 5; i++) bits |= bit(8, i) << i;
  bits |= bit(8, 7) << 6;
  bits |= bit(8, 8) << 7;
  bits |= bit(7, 8) << 8;
  for (let i = 9; i < 15; i++) bits |= bit(14 - i, 8) << i;
  return bits;
}

/** The second copy: along the bottom-left and top-right finders. */
function formatBitsSecond(m: boolean[][]): number {
  const size = m.length;
  const bit = (x: number, y: number) => (m[y][x] ? 1 : 0);
  let bits = 0;
  for (let i = 0; i < 8; i++) bits |= bit(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) bits |= bit(8, size - 15 + i) << i;
  return bits;
}

/** BCH(15,5) remainder for the format information, generator 0x537. */
function bchFormat(data5: number): number {
  let rem = data5;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return (data5 << 10) | rem;
}

function hasFinder(m: boolean[][], left: number, top: number): boolean {
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 7; x++) {
      const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      if (m[top + y][left + x] !== (ring !== 2)) return false;
    }
  }
  return true;
}

/** Fills a grid from an SVG path made of `M x y h n v 1 h -n z` runs. */
function rasterise(d: string, size: number): boolean[][] {
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
  let consumed = 0;
  for (const [whole, x, y, n, back] of d.matchAll(re)) {
    expect(back).toBe(n);
    for (let i = 0; i < Number(n); i++) grid[Number(y)][Number(x) + i] = true;
    consumed += whole.length;
  }
  expect(consumed).toBe(d.length); // nothing in the path but runs
  return grid;
}

describe("ticketQrMatrix", () => {
  it("matches the decoder-verified golden matrix for SH1:7KQM-2HXD", () => {
    expect(toRows(ticketQrMatrix("7KQM-2HXD")!)).toEqual(GOLDEN_7KQM_2HXD);
  });

  it.each(["7KQM-2HXD", "AAAA-AAAA", "9999-9999", "ZZZZ-2222", "ABCD-EFGH"])(
    "%s: a version 2 symbol (25 × 25) with finders, timing, the alignment pattern and level H format information",
    (code) => {
      const m = ticketQrMatrix(code)!;
      expect(m).toHaveLength(25);
      for (const row of m) expect(row).toHaveLength(25);
      expect(hasFinder(m, 0, 0)).toBe(true);
      expect(hasFinder(m, 18, 0)).toBe(true);
      expect(hasFinder(m, 0, 18)).toBe(true);
      for (let i = 8; i <= 16; i++) {
        expect(m[6][i]).toBe(i % 2 === 0); // timing patterns
        expect(m[i][6]).toBe(i % 2 === 0);
      }
      // Version 2's alignment pattern, centred at (18, 18): dark ring, light ring, dark centre.
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) expect(m[18 + dy][18 + dx]).toBe(Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
      expect(m[17][8]).toBe(true); // the always-dark module (8, 4V + 9)

      const raw = formatBitsTopLeft(m);
      expect(formatBitsSecond(m)).toBe(raw);
      const format = raw ^ 0x5412;
      const data5 = format >>> 10;
      expect(bchFormat(data5)).toBe(format); // a valid codeword, not noise
      expect(data5 >>> 3).toBe(0b10); // error correction level H
    },
  );

  it("is deterministic, and different codes give different symbols", () => {
    expect(ticketQrMatrix("7KQM-2HXD")).toEqual(ticketQrMatrix("7KQM-2HXD"));
    expect(toRows(ticketQrMatrix("7KQM-2HXE")!)).not.toEqual(GOLDEN_7KQM_2HXD);
  });

  it.each([
    "",
    "7kqm-2hxd", // not canonical: lower case
    "SH1:7KQM-2HXD", // the payload, not a code
    " 7KQM-2HXD",
    "7KQM2HXD",
    "7KQM-2HX",
    "7KQM-2HXDD",
    "0KQM-2HXD", // 0, O, 1 and I aren't in the alphabet
    "OKQM-2HXD",
    "1KQM-2HXD",
    "IKQM-2HXD",
    "A<B>-\"1\"&",
    "7KQM-2HXD\n",
  ])("returns null for %j", (code) => {
    expect(ticketQrMatrix(code)).toBeNull();
  });

  it("returns null for a value that isn't a string at all", () => {
    expect(ticketQrMatrix(undefined as unknown as string)).toBeNull();
    expect(ticketQrMatrix(12345678 as unknown as string)).toBeNull();
  });
});

describe("ticketQrSymbol (the centre ü's cleared area)", () => {
  it("clears the centre 7 × 7 modules (rows and columns 9 to 15) and keeps every other module", () => {
    const plain = ticketQrMatrix("7KQM-2HXD")!;
    const symbol = ticketQrSymbol("7KQM-2HXD")!;
    expect([QR_LOGO_CLEAR_MODULES, QR_LOGO_MARK_MODULES, QR_LOGO_MAX_MODULES]).toEqual([7, 5, 9]);
    expect(symbol.logo).toEqual({ start: 9, size: 7 });
    expect(symbol.mark).toEqual({ start: 10, size: 5 }); // a 1-module light pad all round
    for (let y = 0; y < 25; y++) {
      for (let x = 0; x < 25; x++) {
        const inLogo = x >= 9 && x <= 15 && y >= 9 && y <= 15;
        expect(symbol.matrix[y][x]).toBe(inLogo ? false : plain[y][x]);
      }
    }
    // 49 of 625 modules: 7.8% of the symbol, well under the 13% ceiling (9 × 9).
    expect((7 * 7) / (25 * 25)).toBeCloseTo(0.078, 3);
  });

  it("never touches a function pattern: finders, separators, timing, the alignment pattern or format information", () => {
    const fn = qrFunctionModules(25);
    // Spot checks of the function-pattern map itself.
    for (const [x, y] of [[0, 0], [7, 7], [24, 0], [17, 7], [0, 24], [7, 17], [12, 6], [6, 12], [16, 16], [20, 20], [8, 3], [3, 8], [8, 17], [20, 8]]) {
      expect(fn[y][x], `${x},${y}`).toBe(true);
    }
    for (const [x, y] of [[9, 9], [15, 15], [12, 12], [15, 9], [9, 15], [21, 21], [10, 22]]) expect(fn[y][x], `${x},${y}`).toBe(false);
    expect(squareHitsFunctionPatterns(25, ticketQrSymbol("7KQM-2HXD")!.logo)).toBe(false);
    // 7 × 7 is the largest centred square that does: 9 × 9 (the ceiling) already reaches the format
    // information at (8, 8) and the alignment pattern at (16, 16); 13 × 13 the timing patterns too.
    expect(squareHitsFunctionPatterns(25, centredSquare(25, 9))).toBe(true);
    expect(squareHitsFunctionPatterns(25, centredSquare(25, 13))).toBe(true);
  });

  it("clearSquare copies; the plain matrix is untouched", () => {
    const plain = ticketQrMatrix("ABCD-EFGH")!;
    const before = toRows(plain);
    const cleared = clearSquare(plain, { start: 9, size: 7 });
    expect(toRows(plain)).toEqual(before);
    expect(cleared[12].slice(9, 16).every((dark) => !dark)).toBe(true);
  });

  it("is null for a code that isn't a real one", () => {
    expect(ticketQrSymbol("7kqm-2hxd")).toBeNull();
    expect(ticketQrSymbol("")).toBeNull();
  });

  it("centredSquare refuses a side that can't be centred exactly", () => {
    expect(() => centredSquare(25, 8)).toThrow(RangeError);
    expect(() => centredSquare(25, 27)).toThrow(RangeError);
    expect(() => qrFunctionModules(24)).toThrow(RangeError);
  });
});

describe("ticketQrSvgPath", () => {
  it("draws exactly the dark modules, offset by a 4-module quiet zone, on whole units", () => {
    const m = ticketQrMatrix("7KQM-2HXD")!;
    const { d, size } = ticketQrSvgPath(m);
    expect(QR_QUIET_ZONE_MODULES).toBe(4);
    expect(size).toBe(33);
    expect(d).toMatch(/^M4 4h7v1h-7z/); // top-left finder's first row
    const grid = rasterise(d, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inside = y >= 4 && y < 29 && x >= 4 && x < 29;
        expect(grid[y][x]).toBe(inside ? m[y - 4][x - 4] : false);
      }
    }
  });

  it("is an empty path for an all-light matrix", () => {
    expect(ticketQrSvgPath([[false, false], [false, false]])).toEqual({ d: "", size: 10 });
  });
});

describe("ticketQrLabel", () => {
  it("names the ticket", () => {
    expect(ticketQrLabel("7KQM-2HXD")).toBe("QR code for ticket 7KQM-2HXD");
  });
});

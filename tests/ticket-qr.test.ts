import { describe, expect, it } from "vitest";
import { QR_QUIET_ZONE_MODULES, ticketQrLabel, ticketQrMatrix, ticketQrSvgPath } from "@/lib/ticket-qr";

/*
 * There's no QR decoder among the project's dependencies, so these tests
 * check the symbol against the QR standard (ISO/IEC 18004) structurally, and
 * pin one known-good matrix. That golden matrix, and over a thousand random
 * codes, were decoded to `SH1:<code>` at level Q by two independent decoders
 * (jsQR and ZXing) in a one-off script when the encoder was vendored
 * (lib/qr/qrcodegen.ts). If the golden test fails, the encoder's output has
 * changed: re-verify it with a decoder before updating it.
 */

const GOLDEN_7KQM_2HXD = [
  "#######.##.##.#######",
  "#.....#.#####.#.....#",
  "#.###.#.##.##.#.###.#",
  "#.###.#.#.#...#.###.#",
  "#.###.#.##.#..#.###.#",
  "#.....#..#....#.....#",
  "#######.#.#.#.#######",
  "........###..........",
  ".##.#.##..##..#.#####",
  "..##....##.###.###...",
  "#.#..##.##.###.##.##.",
  "####.....##.#.#.###.#",
  ".....##.#..#..####.#.",
  "........####....##.#.",
  "#######.#.###...#..#.",
  "#.....#.....###.#..##",
  "#.###.#.#..#..#######",
  "#.###.#..#.#.#.#.#.#.",
  "#.###.#.#..#..####..#",
  "#.....#.##.###....###",
  "#######..#.#..###...#",
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
    "%s: a version 1 symbol (21 × 21) with finders, timing and level Q format information",
    (code) => {
      const m = ticketQrMatrix(code)!;
      expect(m).toHaveLength(21);
      for (const row of m) expect(row).toHaveLength(21);
      expect(hasFinder(m, 0, 0)).toBe(true);
      expect(hasFinder(m, 14, 0)).toBe(true);
      expect(hasFinder(m, 0, 14)).toBe(true);
      for (let i = 8; i <= 12; i++) {
        expect(m[6][i]).toBe(i % 2 === 0); // timing patterns
        expect(m[i][6]).toBe(i % 2 === 0);
      }
      expect(m[13][8]).toBe(true); // the always-dark module (4V + 9, 8)

      const raw = formatBitsTopLeft(m);
      expect(formatBitsSecond(m)).toBe(raw);
      const format = raw ^ 0x5412;
      const data5 = format >>> 10;
      expect(bchFormat(data5)).toBe(format); // a valid codeword, not noise
      expect(data5 >>> 3).toBe(0b11); // error correction level Q
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

describe("ticketQrSvgPath", () => {
  it("draws exactly the dark modules, offset by a 4-module quiet zone, on whole units", () => {
    const m = ticketQrMatrix("7KQM-2HXD")!;
    const { d, size } = ticketQrSvgPath(m);
    expect(QR_QUIET_ZONE_MODULES).toBe(4);
    expect(size).toBe(29);
    expect(d).toMatch(/^M4 4h7v1h-7z/); // top-left finder's first row
    const grid = rasterise(d, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const inside = y >= 4 && y < 25 && x >= 4 && x < 25;
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

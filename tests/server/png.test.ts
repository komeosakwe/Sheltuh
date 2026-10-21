import { crc32 as zlibCrc32, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { crc32, encodePng, MAX_PNG_SIDE } from "@/lib/server/png";
import { ticketQrMatrix } from "@/lib/ticket-qr";

interface Chunk {
  type: string;
  data: Buffer;
  crc: number;
  /** The type and data, which the CRC covers. */
  covered: Buffer;
}

/** Splits a PNG into chunks, checking the signature and that nothing trails. */
function readChunks(png: Buffer): Chunk[] {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: Chunk[] = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    chunks.push({ type, data, crc: png.readUInt32BE(at + 8 + length), covered: png.subarray(at + 4, at + 8 + length) });
    at += 12 + length;
  }
  expect(at).toBe(png.length);
  return chunks;
}

/** Decodes our 1-bit greyscale PNG back to pixels (true = black). */
function readPixels(png: Buffer): { width: number; height: number; dark: boolean[][] } {
  const chunks = readChunks(png);
  const ihdr = chunks[0];
  expect(ihdr.type).toBe("IHDR");
  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  expect([...ihdr.data.subarray(8)]).toEqual([1, 0, 0, 0, 0]); // 1-bit, greyscale, deflate, filter 0, no interlace
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));
  const stride = 1 + Math.ceil(width / 8);
  expect(raw.length).toBe(stride * height);
  const dark: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    expect(raw[y * stride]).toBe(0); // filter: none
    dark.push(Array.from({ length: width }, (_, x) => ((raw[y * stride + 1 + (x >> 3)] >> (7 - (x & 7))) & 1) === 0));
  }
  return { width, height, dark };
}

describe("crc32", () => {
  it("is the standard CRC-32 (check value, and agrees with node:zlib)", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    expect(crc32(Buffer.alloc(0))).toBe(0);
    const sample = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 7919) & 0xff));
    expect(crc32(sample)).toBe(zlibCrc32(sample));
  });
});

describe("encodePng", () => {
  it("is a well-formed PNG: IHDR, IDAT, IEND, each with a valid CRC", () => {
    const png = encodePng(ticketQrMatrix("7KQM-2HXD")!, 12, 4);
    const chunks = readChunks(png);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "IDAT", "IEND"]);
    for (const c of chunks) expect(c.crc).toBe(zlibCrc32(c.covered));
    expect(chunks[2].data).toHaveLength(0);
  });

  it("draws every module as a scale × scale block of pure black or white, inside a white quiet zone", () => {
    const matrix = ticketQrMatrix("7KQM-2HXD")!;
    const scale = 12;
    const quiet = 4;
    const { width, height, dark } = readPixels(encodePng(matrix, scale, quiet));
    expect(width).toBe((21 + 2 * quiet) * scale); // 348
    expect(height).toBe(width);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const my = Math.floor(y / scale) - quiet;
        const mx = Math.floor(x / scale) - quiet;
        const want = my >= 0 && my < 21 && mx >= 0 && mx < 21 ? matrix[my][mx] : false;
        if (dark[y][x] !== want) throw new Error(`pixel ${x},${y} should be ${want ? "black" : "white"}`);
      }
    }
  });

  it("handles widths that aren't a multiple of 8, rectangles and no quiet zone", () => {
    const matrix = [
      [true, false, true],
      [false, true, false],
    ];
    const { width, height, dark } = readPixels(encodePng(matrix, 1, 0));
    expect([width, height]).toEqual([3, 2]);
    expect(dark).toEqual(matrix);
    const scaled = readPixels(encodePng(matrix, 3, 1));
    expect([scaled.width, scaled.height]).toEqual([15, 12]);
    expect(scaled.dark[3].slice(3, 6)).toEqual([true, true, true]);
    expect(scaled.dark[0].every((d) => !d)).toBe(true);
  });

  it("keeps a ticket QR small enough to inline several in one email", () => {
    expect(encodePng(ticketQrMatrix("7KQM-2HXD")!, 12, 4).length).toBeLessThan(1024);
  });

  it.each([
    ["an empty matrix", [], 1, 0],
    ["an empty row", [[]], 1, 0],
    ["a ragged matrix", [[true, false], [true]], 1, 0],
    ["a zero scale", [[true]], 0, 0],
    ["a fractional scale", [[true]], 1.5, 0],
    ["a negative quiet zone", [[true]], 1, -1],
    ["a fractional quiet zone", [[true]], 1, 0.5],
    ["an image over the size cap", [[true]], MAX_PNG_SIDE + 1, 0],
  ])("refuses %s", (_, matrix, scale, quiet) => {
    expect(() => encodePng(matrix as boolean[][], scale as number, quiet as number)).toThrow(RangeError);
  });
});

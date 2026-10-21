import { deflateSync } from "node:zlib";

/**
 * A minimal PNG encoder for black-and-white module grids (ticket QR codes in
 * the ticket email, lib/server/ticket-email.ts). Server only: it uses
 * node:zlib.
 *
 * Output is 1-bit greyscale (colour type 0, bit depth 1): every pixel is pure
 * black or pure white, nothing in between, so there's no antialiasing for a
 * scanner to misread. Each module becomes a `scale` × `scale` block, with
 * `quietZone` light modules on every side.
 */

/** Largest image side we'll make, in pixels. A ticket QR is a few hundred. */
export const MAX_PNG_SIDE = 4096;

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (ISO 3309 / PNG), as PNG chunks carry it. */
export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  // The CRC covers the type and the data, not the length.
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * The PNG for `matrix` (`true` = dark), rows top to bottom. Throws a
 * RangeError for an empty or ragged matrix, a `scale` that isn't a whole
 * number from 1, a negative or fractional `quietZone`, or an image wider than
 * MAX_PNG_SIDE.
 */
export function encodePng(matrix: boolean[][], scale: number, quietZone: number): Buffer {
  const rows = matrix.length;
  const cols = rows > 0 ? matrix[0].length : 0;
  if (rows === 0 || cols === 0 || matrix.some((row) => row.length !== cols)) {
    throw new RangeError("The matrix must be a non-empty rectangle.");
  }
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError("Scale must be a whole number from 1.");
  if (!Number.isInteger(quietZone) || quietZone < 0) throw new RangeError("Quiet zone must be a whole number from 0.");
  const width = (cols + quietZone * 2) * scale;
  const height = (rows + quietZone * 2) * scale;
  if (width > MAX_PNG_SIDE || height > MAX_PNG_SIDE) throw new RangeError("Image too large.");

  // Scanlines: a filter byte (0, none), then 8 pixels a byte, most significant
  // bit first, 1 = white. Unused bits at the end of a row are left 0.
  const stride = 1 + Math.ceil(width / 8);
  const raw = Buffer.alloc(stride * height);
  for (let py = 0; py < height; py++) {
    const my = Math.floor(py / scale) - quietZone;
    const row = my >= 0 && my < rows ? matrix[my] : null;
    const offset = py * stride + 1;
    for (let px = 0; px < width; px++) {
      const mx = Math.floor(px / scale) - quietZone;
      const dark = row !== null && mx >= 0 && mx < cols && row[mx] === true;
      if (!dark) raw[offset + (px >> 3)] |= 0x80 >> (px & 7);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 1; // bit depth
  header[9] = 0; // colour type: greyscale
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method 0
  header[12] = 0; // no interlace

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

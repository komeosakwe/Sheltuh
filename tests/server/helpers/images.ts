import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { expect } from "vitest";
import { crc32, encodePng } from "@/lib/server/png";

// Test images for the server's image re-encoding (member photos, organiser
// logos, event photos): uploads carrying EXIF with GPS (and, optionally, an
// orientation and a camera serial number) and an ICC profile, and chunk
// listers to prove none of it survives. Generated here: no real photo is
// committed.

// GPS coordinates written into the test photo (Melbourne): 37° 48' 12.34" S, 144° 57' 56.78" E.
export const CAMERA_MAKE = "SpyCam-1234";
/** The camera's serial number (EXIF BodySerialNumber), when a fixture asks for one. */
export const CAMERA_SERIAL = "SN-0042-LEAK";

type IfdValue =
  | { ascii: string }
  | { short: number }
  | { rationals: [number, number][] }
  /** A pointer (LONG) to a sub-IFD written after this one's data. */
  | { ifd: IfdEntry[] };

interface IfdEntry {
  tag: number;
  value: IfdValue;
}

/** Writes a little-endian IFD (entries in ascending tag order) at `at`, its out-of-line data after it; returns where it ends. */
function writeIfd(tiff: Buffer, at: number, entries: IfdEntry[]): number {
  tiff.writeUInt16LE(entries.length, at);
  const entriesEnd = at + 2 + entries.length * 12;
  tiff.writeUInt32LE(0, entriesEnd); // no next IFD
  let data = entriesEnd + 4;
  entries.forEach(({ tag, value }, i) => {
    const e = at + 2 + i * 12;
    tiff.writeUInt16LE(tag, e);
    if ("ascii" in value) {
      const text = Buffer.from(`${value.ascii}\0`, "latin1");
      tiff.writeUInt16LE(2, e + 2);
      tiff.writeUInt32LE(text.length, e + 4);
      if (text.length <= 4) {
        text.copy(tiff, e + 8);
      } else {
        tiff.writeUInt32LE(data, e + 8);
        text.copy(tiff, data);
        data += text.length + (text.length & 1);
      }
    } else if ("short" in value) {
      tiff.writeUInt16LE(3, e + 2);
      tiff.writeUInt32LE(1, e + 4);
      tiff.writeUInt16LE(value.short, e + 8);
    } else if ("rationals" in value) {
      tiff.writeUInt16LE(5, e + 2);
      tiff.writeUInt32LE(value.rationals.length, e + 4);
      tiff.writeUInt32LE(data, e + 8);
      for (const [n, d] of value.rationals) {
        tiff.writeUInt32LE(n, data);
        tiff.writeUInt32LE(d, data + 4);
        data += 8;
      }
    } else {
      tiff.writeUInt16LE(4, e + 2);
      tiff.writeUInt32LE(1, e + 4);
      tiff.writeUInt32LE(data, e + 8);
      data = writeIfd(tiff, data, value.ifd);
    }
  });
  return data;
}

export interface ExifOptions {
  /** EXIF orientation (1..8): 6 means "turn 90° clockwise to display". */
  orientation?: number;
  /** Adds an Exif sub-IFD with BodySerialNumber CAMERA_SERIAL. */
  serial?: boolean;
}

/**
 * A little-endian TIFF block (no "Exif" prefix): IFD0 with the camera make,
 * optionally an orientation and a pointer to an Exif sub-IFD with the
 * camera's serial number, and a pointer to a GPS IFD holding latitude and
 * longitude (refs and three rationals each).
 */
export function tiffWithGps(options: ExifOptions = {}): Buffer {
  const ifd0: IfdEntry[] = [{ tag: 0x010f, value: { ascii: CAMERA_MAKE } }];
  if (options.orientation !== undefined) ifd0.push({ tag: 0x0112, value: { short: options.orientation } });
  if (options.serial) ifd0.push({ tag: 0x8769, value: { ifd: [{ tag: 0xa431, value: { ascii: CAMERA_SERIAL } }] } });
  ifd0.push({
    tag: 0x8825,
    value: {
      ifd: [
        { tag: 0x0001, value: { ascii: "S" } },
        { tag: 0x0002, value: { rationals: [[37, 1], [48, 1], [1234, 100]] } },
        { tag: 0x0003, value: { ascii: "E" } },
        { tag: 0x0004, value: { rationals: [[144, 1], [57, 1], [5678, 100]] } },
      ],
    },
  });
  const tiff = Buffer.alloc(1024);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  return tiff.subarray(0, writeIfd(tiff, 8, ifd0));
}

/** tiffWithGps as a JPEG APP1 / WebP EXIF payload: "Exif\0\0" first. */
export function exifWithGps(options: ExifOptions = {}): Buffer {
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiffWithGps(options)]);
}

/** The rational 1234/100 as stored: proof the GPS seconds are in a file. */
export const GPS_SECONDS = Buffer.from([0xd2, 0x04, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);

/** `jpeg` with an APP1 EXIF segment spliced in after SOI. */
function spliceExif(jpeg: Buffer, exif: Buffer): Buffer {
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), app1, exif, jpeg.subarray(2)]);
}

/** A 900 × 600 JPEG with an ICC profile and, spliced in after SOI, an APP1 EXIF segment with GPS. */
export async function jpegWithGps(options: ExifOptions = {}): Promise<Buffer> {
  const base = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 220, g: 72, b: 0 } } })
    .withIccProfile("p3")
    .jpeg()
    .toBuffer();
  return spliceExif(base, exifWithGps(options));
}

/** Sizes of the two-colour photo below, as stored (before its orientation is applied). */
export const SPLIT_PHOTO = { width: 120, height: 80 } as const;

/**
 * A SPLIT_PHOTO-sized JPEG, its left half red and its right half blue, with an
 * ICC profile and EXIF holding GPS, a camera serial and `orientation` (6 by
 * default: turned 90° clockwise to display, as a phone held upright writes
 * it). Shown the right way up, it's 80 × 120, red on top and blue below.
 */
export async function orientedJpegWithGps(orientation = 6): Promise<Buffer> {
  const { width, height } = SPLIT_PHOTO;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) pixels.set(x < width / 2 ? [255, 0, 0] : [0, 0, 255], (y * width + x) * 3);
  }
  const base = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .withIccProfile("p3")
    .jpeg({ quality: 95 })
    .toBuffer();
  return spliceExif(base, exifWithGps({ orientation, serial: true }));
}

/** A PNG chunk: length, type, data, CRC. */
function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * A 64 × 48 PNG with transparency, carrying an `eXIf` chunk (GPS, serial)
 * and a `tEXt` chunk with the location in words, both before IDAT.
 */
export async function pngWithGps(): Promise<Buffer> {
  const base = await sharp({ create: { width: 64, height: 48, channels: 4, background: { r: 0, g: 160, b: 80, alpha: 0.5 } } })
    .png()
    .toBuffer();
  const ihdrEnd = 8 + 12 + 13;
  return Buffer.concat([
    base.subarray(0, ihdrEnd),
    pngChunk("eXIf", tiffWithGps({ serial: true })),
    pngChunk("tEXt", Buffer.from(`Comment\0Taken at ${CAMERA_MAKE}, Fitzroy`, "latin1")),
    base.subarray(ihdrEnd),
  ]);
}

/** Where the fixtures below say where a photo was taken. */
export const PLACE_TEXT = "Taken in Fitzroy";

/**
 * A 40 × 30 PNG with transparency carrying the PNG text chunks pngWithGps
 * doesn't: `iTXt` (international, uncompressed: PLACE_TEXT) and `zTXt`
 * (deflated: the camera's serial), both before IDAT.
 */
export async function pngWithTextChunks(): Promise<Buffer> {
  const base = await sharp({ create: { width: 40, height: 30, channels: 4, background: { r: 0, g: 64, b: 255, alpha: 0.5 } } })
    .png()
    .toBuffer();
  const ihdrEnd = 8 + 12 + 13;
  // keyword \0, compression flag 0, method 0, language "en" \0, translated keyword \0, text
  const itxt = Buffer.concat([Buffer.from("Description\0\0\0en\0Description\0", "latin1"), Buffer.from(PLACE_TEXT, "utf8")]);
  // keyword \0, method 0, deflated text
  const ztxt = Buffer.concat([Buffer.from("Comment\0\0", "latin1"), deflateSync(Buffer.from(`Camera ${CAMERA_SERIAL}`, "latin1"))]);
  return Buffer.concat([base.subarray(0, ihdrEnd), pngChunk("iTXt", itxt), pngChunk("zTXt", ztxt), base.subarray(ihdrEnd)]);
}

/** A JPEG marker segment: marker, length (counting itself), data. */
function jpegSegment(marker: number, data: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(marker, 0);
  header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([header, data]);
}

/** A Photoshop APP13 payload holding one IPTC-IIM record: 2:120 (caption) PLACE_TEXT. */
function iptcApp13(): Buffer {
  const caption = Buffer.from(PLACE_TEXT, "latin1");
  const iim = Buffer.concat([Buffer.from([0x1c, 0x02, 0x78, caption.length >> 8, caption.length & 0xff]), caption]);
  const resource = Buffer.alloc(12);
  resource.write("8BIM", 0, "latin1");
  resource.writeUInt16BE(0x0404, 4); // IPTC-NAA
  resource.writeUInt16BE(0, 6); // empty name, padded
  resource.writeUInt32BE(iim.length, 8);
  return Buffer.concat([Buffer.from("Photoshop 3.0\0", "latin1"), resource, iim, Buffer.alloc(iim.length & 1)]);
}

/**
 * A 40 × 30 JPEG carrying what the EXIF fixtures don't: an APP13 IPTC record
 * (PLACE_TEXT), a COM comment segment (the camera's serial), and `trailer`
 * appended after its EOI marker (data a decoder ignores, e.g. another file).
 */
export async function jpegWithIptcCommentAndTrailer(trailer: Buffer): Promise<Buffer> {
  const base = await sharp({ create: { width: 40, height: 30, channels: 3, background: { r: 32, g: 64, b: 128 } } })
    .jpeg()
    .toBuffer();
  return Buffer.concat([
    base.subarray(0, 2),
    jpegSegment(0xffed, iptcApp13()),
    jpegSegment(0xfffe, Buffer.from(`Shot on ${CAMERA_MAKE} ${CAMERA_SERIAL}`, "latin1")),
    base.subarray(2),
    trailer,
  ]);
}

/** The four-character types of a PNG file's chunks. */
export function pngChunks(bytes: Buffer): string[] {
  expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks: string[] = [];
  for (let i = 8; i + 8 <= bytes.length; ) {
    chunks.push(bytes.toString("latin1", i + 4, i + 8));
    i += 12 + bytes.readUInt32BE(i);
  }
  return chunks;
}

/**
 * A small PNG that really decodes (a 1-bit pattern, 12 × 12 px), made
 * synchronously: uploads are re-encoded, so a fixture must be a real image.
 * A different `variant` is a different picture.
 */
export function testPng(variant = 0): Uint8Array<ArrayBuffer> {
  // 16 cells, each dark or light by one bit of a hash of `variant`.
  const bits = (Math.imul(variant + 1, 2654435761) >>> 0) ^ 0x5a5a;
  const matrix = Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ((bits >>> (x + 4 * y)) & 1) === 1));
  const png = encodePng(matrix, 2, 1);
  // Copied out of the Buffer's pool, so it's a plain ArrayBuffer-backed body (BodyInit).
  const out = new Uint8Array(png.length);
  out.set(png);
  return out;
}

/** The four-character codes of a WebP file's RIFF chunks. */
export function webpChunks(bytes: Buffer): string[] {
  expect(bytes.toString("latin1", 0, 4)).toBe("RIFF");
  expect(bytes.toString("latin1", 8, 12)).toBe("WEBP");
  const chunks: string[] = [];
  for (let i = 12; i + 8 <= bytes.length; ) {
    const size = bytes.readUInt32LE(i + 4);
    chunks.push(bytes.toString("latin1", i, i + 4));
    i += 8 + size + (size & 1);
  }
  return chunks;
}

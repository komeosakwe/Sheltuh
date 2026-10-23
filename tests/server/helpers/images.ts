import sharp from "sharp";
import { expect } from "vitest";

// Test images for the server's image re-encoding (member photos,
// organiser logos): an upload carrying EXIF with GPS and an ICC profile, and
// a WebP chunk lister to prove none of it survives.

// GPS coordinates written into the test photo (Melbourne): 37° 48' 12.34" S, 144° 57' 56.78" E.
export const CAMERA_MAKE = "SpyCam-1234";

/**
 * A little-endian TIFF/EXIF block: IFD0 with the camera make and a pointer to
 * a GPS IFD holding latitude and longitude (refs and three rationals each).
 */
export function exifWithGps(): Buffer {
  const tiff = Buffer.alloc(152);
  tiff.write("II", 0, "latin1");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  const entry = (at: number, tag: number, type: number, count: number, value: number | string) => {
    tiff.writeUInt16LE(tag, at);
    tiff.writeUInt16LE(type, at + 2);
    tiff.writeUInt32LE(count, at + 4);
    if (typeof value === "string") tiff.write(value.padEnd(4, "\0"), at + 8, "latin1");
    else tiff.writeUInt32LE(value, at + 8);
  };
  // IFD0 at 8: Make (ASCII, 12 bytes at 38), GPSInfo pointer (-> 50).
  tiff.writeUInt16LE(2, 8);
  entry(10, 0x010f, 2, 12, 38);
  entry(22, 0x8825, 4, 1, 50);
  tiff.writeUInt32LE(0, 34);
  tiff.write(`${CAMERA_MAKE}\0`, 38, "latin1");
  // GPS IFD at 50: LatitudeRef "S", Latitude (-> 104), LongitudeRef "E", Longitude (-> 128).
  tiff.writeUInt16LE(4, 50);
  entry(52, 0x0001, 2, 2, "S");
  entry(64, 0x0002, 5, 3, 104);
  entry(76, 0x0003, 2, 2, "E");
  entry(88, 0x0004, 5, 3, 128);
  tiff.writeUInt32LE(0, 100);
  const rationals = (at: number, values: [number, number][]) =>
    values.forEach(([n, d], i) => {
      tiff.writeUInt32LE(n, at + i * 8);
      tiff.writeUInt32LE(d, at + i * 8 + 4);
    });
  rationals(104, [[37, 1], [48, 1], [1234, 100]]);
  rationals(128, [[144, 1], [57, 1], [5678, 100]]);
  return Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
}

/** The rational 1234/100 as stored: proof the GPS seconds are in a file. */
export const GPS_SECONDS = Buffer.from([0xd2, 0x04, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00]);

/** A 900 × 600 JPEG with an ICC profile and, spliced in after SOI, an APP1 EXIF segment with GPS. */
export async function jpegWithGps(): Promise<Buffer> {
  const base = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 220, g: 72, b: 0 } } })
    .withIccProfile("p3")
    .jpeg()
    .toBuffer();
  const exif = exifWithGps();
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([base.subarray(0, 2), app1, exif, base.subarray(2)]);
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

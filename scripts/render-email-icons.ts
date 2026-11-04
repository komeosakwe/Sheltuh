/**
 * Draws the three small line icons the event reminder shows beside its
 * details (calendar, clock, map pin) as transparent PNGs, with no browser and
 * no new dependency.
 *
 *   node --import tsx scripts/render-email-icons.ts
 *
 * Each icon is 40 x 40 px (shown at 20 x 20, sharp at 2x), drawn in the
 * emails' ink (#171411) on a transparent ground, with an antialiased 1.5-unit
 * stroke and round caps (a 24-unit grid, scaled by 40/24). Email clients
 * don't show SVG, so these are PNGs hosted at `/email/icons/*.png`, which the
 * app serves from `public/` (lib/server/email-modern-layout.ts, `ICON_PATHS`).
 *
 * lib/server/png.ts only writes 1-bit opaque images (QR codes), which can't be
 * antialiased or transparent, so this writes 8-bit RGBA itself and borrows its
 * CRC-32. Rerun only when an icon changes; the output is deterministic.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { crc32 } from "../lib/server/png";

const SIZE = 40;
const GRID = 24;
const STROKE = 1.5;
const INK_RGB = [0x17, 0x14, 0x11] as const;
const SAMPLES = 6; // SAMPLES x SAMPLES points per pixel

type Point = [number, number];
type Path = Point[];

const arc = (cx: number, cy: number, r: number, from: number, to: number, steps = 32): Path =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const a = from + ((to - from) * i) / steps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as Point;
  });

const cubic = (p0: Point, p1: Point, p2: Point, p3: Point, steps = 32): Path =>
  Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [
      u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
      u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1],
    ] as Point;
  });

/** A closed rounded rectangle. */
function roundedRect(x: number, y: number, w: number, h: number, r: number): Path {
  const q = Math.PI / 2;
  return [
    ...arc(x + w - r, y + r, r, -q, 0, 8),
    ...arc(x + w - r, y + h - r, r, 0, q, 8),
    ...arc(x + r, y + h - r, r, q, 2 * q, 8),
    ...arc(x + r, y + r, r, 2 * q, 3 * q, 8),
    [x + w - r, y],
  ];
}

const ICONS: Record<string, Path[]> = {
  calendar: [
    roundedRect(3, 5, 18, 16, 3),
    [[3, 10], [21, 10]],
    [[8, 3], [8, 7]],
    [[16, 3], [16, 7]],
  ],
  clock: [arc(12, 12, 9, 0, 2 * Math.PI, 64), [[12, 7], [12, 12], [15.5, 14]]],
  pin: [
    [
      ...arc(12, 10, 8, Math.PI, 2 * Math.PI, 32),
      ...cubic([20, 10], [20, 16], [12, 22], [12, 22]),
      ...cubic([12, 22], [12, 22], [4, 16], [4, 10]),
    ],
    arc(12, 10, 3, 0, 2 * Math.PI, 32),
  ],
};

function distanceToSegment(px: number, py: number, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len2));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function rasterise(paths: Path[]): Buffer {
  const scale = GRID / SIZE;
  const rows: number[] = [];
  for (let y = 0; y < SIZE; y++) {
    rows.push(0); // filter: none
    for (let x = 0; x < SIZE; x++) {
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const gx = (x + (sx + 0.5) / SAMPLES) * scale;
          const gy = (y + (sy + 0.5) / SAMPLES) * scale;
          let hit = false;
          for (const p of paths) {
            for (let i = 0; i + 1 < p.length && !hit; i++) hit = distanceToSegment(gx, gy, p[i], p[i + 1]) <= STROKE / 2;
            if (hit) break;
          }
          if (hit) covered++;
        }
      }
      rows.push(...INK_RGB, Math.round((covered / (SAMPLES * SAMPLES)) * 255));
    }
  }
  return Buffer.from(rows);
}

function chunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodeRgba(raw: Buffer): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, "..", "public", "email", "icons");
mkdirSync(outDir, { recursive: true });
for (const [name, paths] of Object.entries(ICONS)) {
  const file = path.join(outDir, `${name}.png`);
  writeFileSync(file, encodeRgba(rasterise(paths)));
  console.log(`wrote ${path.relative(process.cwd(), file)}`);
}

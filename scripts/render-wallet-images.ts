/**
 * Renders the wallet pass images (docs/wallet-setup.md, "Images") from the
 * official brand vectors, with `sharp` (already a dependency). Nothing is
 * fetched and no font is used: every mark is drawn from its SVG path.
 *
 *   node --import tsx scripts/render-wallet-images.ts
 *
 * Writes public/wallet/ (the look of the designer's 20 Nov 2026 frames: a
 * white pass, Signal Orange only in the marks):
 *   apple-icon.png, @2x, @3x       29, 58, 87 px: the secondary ü (public/brand/sheltuh-u.svg)
 *                                  in Black on full-bleed Signal Orange (the PWA icon's look,
 *                                  docs/pwa.md), shown in notifications and on the lock screen
 *   apple-logo.png, @2x, @3x       the uppercase wordmark (public/brand/sheltuh-wordmark.svg) in
 *                                  Signal Orange on transparent, 88 pt wide (20 pt tall), the
 *                                  frame's size (Apple allows up to 160 x 50)
 *   apple-strip.png, @2x, @3x      375 x 98 pt (an event ticket's strip): the wordmark's Ü in
 *                                  Signal Orange on Black. A stand-in for the event's own
 *                                  artwork, which the frame shows there and isn't built
 *   google-logo-v2.png             660 x 660: the wordmark's Ü in Signal Orange on Black (the
 *                                  frame's round logo), inside Google's circle crop
 *   google-hero-v2.png             1032 x 336: the wordmark in Signal Orange on Black (the same
 *                                  stand-in as Apple's strip)
 *   google-logo.png                the look before 21 Nov 2026 (the ü in Black on Signal Orange),
 *   google-hero.png                unchanged: Google classes made before then still fetch these
 *                                  two URLs, so the files stay. No new pass uses them
 * and lib/server/wallet/images.ts: the Apple images as base64, which the
 * .pkpass builder reads (so they're bundled with the route's server function,
 * with no file read at request time, as lib/server/email-wordmark.ts).
 * Google fetches its two images itself, from the site's public URL: give new
 * Google artwork a new file name (google.ts, GOOGLE_LOGO_PATH), never a new
 * image under an old one.
 *
 * tests/server/wallet-apple.test.ts checks the module and the files match.
 * Rerun this only when a mark or a size changes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { WALLET_COLOURS } from "../lib/server/wallet/brand";

const root = process.cwd();
const SIGNAL = WALLET_COLOURS.signal;
const INK = WALLET_COLOURS.ink;

interface Vector {
  viewBox: [number, number, number, number];
  d: string;
}

function readVector(file: string): Vector {
  const src = readFileSync(path.join(root, file), "utf8");
  const viewBox = src.match(/viewBox="([^"]+)"/)![1].split(/\s+/).map(Number) as Vector["viewBox"];
  const d = src.match(/<path d="([^"]+)"/)![1];
  return { viewBox, d };
}

const U = readVector("public/brand/sheltuh-u.svg");
const WORDMARK = readVector("public/brand/sheltuh-wordmark.svg");

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The box round a subpath's points (its curves' control points included: they hug these outlines). */
function boxOf(subpath: string): Box {
  const n = (subpath.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0);
  const ys = n.filter((_, i) => i % 2 === 1);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * The wordmark's own Ü, alone (the frame's round Google logo; the secondary
 * ü of sheltuh-u.svg is a different letterform): the wordmark's path is one
 * subpath per letter plus the Ü's two dots, which are the only shapes that
 * sit wholly above the letters. Its Ü is the letter under them. Throws if
 * the vector ever stops reading that way, rather than draw something else.
 */
function wordmarkU(): Vector {
  const [, vy, , vh] = WORDMARK.viewBox;
  const shapes = WORDMARK.d
    .split(/(?=M )/)
    .map((d) => ({ d: d.trim(), box: boxOf(d) }))
    // The export's empty "M x y Z" moves.
    .filter(({ box }) => box.maxX > box.minX && box.maxY > box.minY);
  const dots = shapes.filter(({ box }) => box.maxY < vy + vh / 4);
  const letters = shapes.filter(({ box }) => box.maxY >= vy + vh / 4);
  const under = letters.filter(({ box }) => dots.every((dot) => dot.box.minX >= box.minX && dot.box.maxX <= box.maxX));
  if (dots.length !== 2 || under.length !== 1) throw new Error("The wordmark's Ü couldn't be read from public/brand/sheltuh-wordmark.svg.");
  const parts = [under[0], ...dots];
  const minX = Math.min(...parts.map((p) => p.box.minX));
  const minY = Math.min(...parts.map((p) => p.box.minY));
  const maxX = Math.max(...parts.map((p) => p.box.maxX));
  const maxY = Math.max(...parts.map((p) => p.box.maxY));
  return { viewBox: [minX, minY, maxX - minX, maxY - minY], d: parts.map((p) => p.d).join(" ") };
}

const CAPITAL_U = wordmarkU();

/** `vector` in `fill`, scaled to `height` px and centred at (cx, cy). */
function placed(vector: Vector, height: number, cx: number, cy: number, fill: string): string {
  const [vx, vy, vw, vh] = vector.viewBox;
  const s = height / vh;
  const tx = cx - (vx + vw / 2) * s;
  const ty = cy - (vy + vh / 2) * s;
  return `<path transform="matrix(${s} 0 0 ${s} ${tx} ${ty})" fill="${fill}" d="${vector.d}"/>`;
}

function svg(width: number, height: number, background: string | null, body: string): Buffer {
  const fill = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${fill}${body}</svg>`,
  );
}

/** A PNG of `source`: opaque on `background` (no alpha channel), or transparent where it's null. */
async function png(source: Buffer, background: string | null): Promise<Buffer> {
  const image = sharp(source, { density: 72 });
  return (background ? image.flatten({ background }).removeAlpha() : image).png({ compressionLevel: 9 }).toBuffer();
}

/** A full-bleed `background` square with `vector` in `fill`, `share` of the square's height. */
const tile = (vector: Vector, size: number, share: number, fill: string, background: string) =>
  png(svg(size, size, background, placed(vector, size * share, size / 2, size / 2, fill)), background);

/** The wordmark in Signal Orange on transparent, 88 pt wide at `scale` (the frame's width; its own height, 20 pt). */
function logo(scale: number) {
  const [, , vw, vh] = WORDMARK.viewBox;
  const width = 88 * scale;
  const markHeight = (width * vh) / vw;
  const height = Math.ceil((88 * vh) / vw) * scale;
  return png(svg(width, height, null, placed(WORDMARK, markHeight, width / 2, height / 2, SIGNAL)), null);
}

/** An event ticket's strip, 375 x 98 pt at `scale`: Black, the wordmark's Ü in Signal Orange at 45% of its height. */
const strip = (scale: number) =>
  png(svg(375 * scale, 98 * scale, INK, placed(CAPITAL_U, 98 * scale * 0.45, (375 * scale) / 2, (98 * scale) / 2, SIGNAL)), INK);

async function main() {
  const out = path.join(root, "public/wallet");
  const files: Record<string, Buffer> = {
    // Small, so the ü takes more of the square than on the PWA icon (53%) to read at 29 px.
    "apple-icon.png": await tile(U, 29, 0.62, INK, SIGNAL),
    "apple-icon@2x.png": await tile(U, 58, 0.62, INK, SIGNAL),
    "apple-icon@3x.png": await tile(U, 87, 0.62, INK, SIGNAL),
    "apple-logo.png": await logo(1),
    "apple-logo@2x.png": await logo(2),
    "apple-logo@3x.png": await logo(3),
    "apple-strip.png": await strip(1),
    "apple-strip@2x.png": await strip(2),
    "apple-strip@3x.png": await strip(3),
    // Google crops its logo to a circle: the Ü at 56% (18 of the frame's 32) stays well inside it.
    "google-logo-v2.png": await tile(CAPITAL_U, 660, 18 / 32, SIGNAL, INK),
    "google-hero-v2.png": await png(svg(1032, 336, INK, placed(WORDMARK, 96, 516, 168, SIGNAL)), INK),
    // The look before 21 Nov 2026, for the Google classes that still point at these two (see the top of this file).
    "google-logo.png": await tile(U, 660, 0.53, INK, SIGNAL),
    "google-hero.png": await png(svg(1032, 336, SIGNAL, placed(WORDMARK, 96, 516, 168, INK)), SIGNAL),
  };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(out, name), bytes);

  // The .pkpass file names Apple expects (icon.png, logo@2x.png, strip@3x.png …).
  const apple = Object.entries(files)
    .filter(([name]) => name.startsWith("apple-"))
    .map(([name, bytes]) => `  "${name.replace(/^apple-/, "")}": "${bytes.toString("base64")}",`)
    .join("\n");
  writeFileSync(
    path.join(root, "lib/server/wallet/images.ts"),
    `// Generated by scripts/render-wallet-images.ts from public/brand/. Don't edit by hand.

/**
 * The Apple Wallet pass images, as base64 PNGs keyed by their name in the
 * .pkpass. Byte-for-byte public/wallet/apple-*.png.
 */
export const APPLE_PASS_IMAGES: Readonly<Record<string, string>> = {
${apple}
};
`,
  );
  console.log(`Wrote ${Object.keys(files).length} images to public/wallet/ and lib/server/wallet/images.ts.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

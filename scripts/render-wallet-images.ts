/**
 * Renders the wallet pass images (docs/wallet-setup.md, "Images") from the
 * official brand vectors, with `sharp` (already a dependency). Nothing is
 * fetched and no font is used: every mark is drawn from its SVG path.
 *
 *   node --import tsx scripts/render-wallet-images.ts
 *
 * Writes public/wallet/:
 *   apple-icon.png, @2x, @3x       29, 58, 87 px: the secondary ü (public/brand/sheltuh-u.svg)
 *                                  in Black on full-bleed Signal Orange (the PWA icon's look,
 *                                  docs/pwa.md), shown in notifications and on the lock screen
 *   apple-logo.png, @2x, @3x       the uppercase wordmark (public/brand/sheltuh-wordmark.svg) in
 *                                  Black on transparent, 30 pt tall (Apple allows up to 160 x 50)
 *   apple-strip.png, @2x, @3x      375 x 98 pt of plain Signal Orange behind the event's name
 *                                  (Black on it, 6.18:1)
 *   google-logo.png                660 x 660: the ü on Signal Orange, inside Google's circle crop
 *   google-hero.png                1032 x 336: the wordmark in Black on Signal Orange
 * and lib/server/wallet/images.ts: the Apple images as base64, which the
 * .pkpass builder reads (so they're bundled with the route's server function,
 * with no file read at request time, as lib/server/email-wordmark.ts).
 * Google fetches its two images itself, from the site's public URL.
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

/** `vector` in Black, scaled to `height` px and centred at (cx, cy). */
function placed(vector: Vector, height: number, cx: number, cy: number): string {
  const [vx, vy, vw, vh] = vector.viewBox;
  const s = height / vh;
  const tx = cx - (vx + vw / 2) * s;
  const ty = cy - (vy + vh / 2) * s;
  return `<path transform="matrix(${s} 0 0 ${s} ${tx} ${ty})" fill="${INK}" d="${vector.d}"/>`;
}

function svg(width: number, height: number, background: string | null, body: string): Buffer {
  const fill = background ? `<rect width="${width}" height="${height}" fill="${background}"/>` : "";
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${fill}${body}</svg>`,
  );
}

async function png(source: Buffer, opaque: boolean): Promise<Buffer> {
  const image = sharp(source, { density: 72 });
  return (opaque ? image.flatten({ background: SIGNAL }).removeAlpha() : image).png({ compressionLevel: 9 }).toBuffer();
}

/** The ü on full-bleed orange, `share` of the square's height. */
const icon = (size: number, share: number) => png(svg(size, size, SIGNAL, placed(U, size * share, size / 2, size / 2)), true);

/** The wordmark, 30 pt tall at `scale`, on transparent. */
function logo(scale: number) {
  const [, , vw, vh] = WORDMARK.viewBox;
  const height = 30 * scale;
  const width = Math.ceil((height * vw) / vh);
  return png(svg(width, height, null, placed(WORDMARK, height, width / 2, height / 2)), false);
}

const strip = (scale: number) => png(svg(375 * scale, 98 * scale, SIGNAL, ""), true);

async function main() {
  const out = path.join(root, "public/wallet");
  const files: Record<string, Buffer> = {
    // Small, so the ü takes more of the square than on the PWA icon (53%) to read at 29 px.
    "apple-icon.png": await icon(29, 0.62),
    "apple-icon@2x.png": await icon(58, 0.62),
    "apple-icon@3x.png": await icon(87, 0.62),
    "apple-logo.png": await logo(1),
    "apple-logo@2x.png": await logo(2),
    "apple-logo@3x.png": await logo(3),
    "apple-strip.png": await strip(1),
    "apple-strip@2x.png": await strip(2),
    "apple-strip@3x.png": await strip(3),
    // Google crops its logo to a circle: the ü at 53%, as the maskable icon, stays inside it.
    "google-logo.png": await icon(660, 0.53),
    "google-hero.png": await png(svg(1032, 336, SIGNAL, placed(WORDMARK, 96, 516, 168)), true),
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

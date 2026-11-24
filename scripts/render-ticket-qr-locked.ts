/**
 * Draws public/email/ticket/qr-locked.png: the ticket-offer email's QR
 * placeholder (docs/architecture.md, "Ticket transfers"; Latte's "Ticket
 * received" frame), shown at 200 x 200 and drawn at 2x (400 x 400).
 *
 *   node --import tsx scripts/render-ticket-qr-locked.ts
 *
 * A QR-like pattern already faded to about 12% (#E0E0E0 on white, since
 * Outlook ignores opacity): the three finder squares and a fixed
 * pseudo-random scatter of modules. It is decorative only and is not a QR
 * code: the format, timing and data areas are noise, so no reader decodes it
 * (tests/server/ticket-transfer-emails.test.ts reads it with ZXing to check).
 * Deterministic; nothing is fetched.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const MODULES = 25;
const PX = 16; // 2x of 8 px a module
const FADED = "#E0E0E0";

function finder(x: number, y: number): string {
  const at = (mx: number, my: number, size: number) => `<rect x="${mx * PX}" y="${my * PX}" width="${size * PX}" height="${size * PX}"`;
  return (
    `${at(x, y, 7)} fill="${FADED}"/>` +
    `${at(x + 1, y + 1, 5)} fill="#FFFFFF"/>` +
    `${at(x + 2, y + 2, 3)} fill="${FADED}"/>`
  );
}

function inFinder(x: number, y: number): boolean {
  const near = (fx: number, fy: number) => x >= fx - 1 && x <= fx + 7 && y >= fy - 1 && y <= fy + 7;
  return near(0, 0) || near(MODULES - 7, 0) || near(0, MODULES - 7);
}

function svg(): string {
  // A small linear congruential generator: the same scatter every run.
  let seed = 0x5eed1120;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 0x100000000;
  };
  const cells: string[] = [];
  for (let y = 0; y < MODULES; y++) {
    for (let x = 0; x < MODULES; x++) {
      const on = next() < 0.45;
      if (on && !inFinder(x, y)) cells.push(`<rect x="${x * PX}" y="${y * PX}" width="${PX}" height="${PX}" fill="${FADED}"/>`);
    }
  }
  const side = MODULES * PX;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}">` +
    `<rect width="${side}" height="${side}" fill="#FFFFFF"/>` +
    finder(0, 0) +
    finder(MODULES - 7, 0) +
    finder(0, MODULES - 7) +
    cells.join("") +
    `</svg>`
  );
}

async function main() {
  const png = await sharp(Buffer.from(svg())).png({ compressionLevel: 9, palette: true }).toBuffer();
  writeFileSync(path.join(process.cwd(), "public/email/ticket/qr-locked.png"), png);
}

void main();

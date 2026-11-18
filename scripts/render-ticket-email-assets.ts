/**
 * Draws the ticket email's small images (docs/design/ticket-email.md §4–§5)
 * with sharp, from SVG written here, at 2x the size they're shown at:
 *
 *   public/email/ticket/stripes-112.png   the card's corner stripes, desktop: 112 x 12 (224 x 24)
 *   public/email/ticket/stripes-72.png    the same, phone: 72 x 12 (144 x 24)
 *   public/email/ticket/notch-left.png    the perforation's half-discs, 12 x 24 (24 x 48),
 *   public/email/ticket/notch-right.png   flat edge against the orange border
 *   public/email/ticket/calendar.png      the info rows' icons, 20 x 20 (40 x 40),
 *   public/email/ticket/pin.png           black, 1.5 px strokes, round caps,
 *   public/email/ticket/info.png          on a transparent ground
 *   public/email/ticket/wordmark.png      the uppercase wordmark, black on white, 106 x 24 (212 x 48)
 *   lib/server/email-ticket-wordmark.ts   the wordmark's bytes as base64 (attached inline, cid:)
 *
 *   node --import tsx scripts/render-ticket-email-assets.ts
 *
 * The stripes are 45° bars of Signal Orange (#FF4800), 8 px wide on an
 * 18 px pitch, clipped to their box, as measured from the design images.
 * Hosted from the site's own origin (lib/server/email-ticket-layout.ts);
 * all are decorative (alt=""), and each has its size set in the markup, so a
 * blocked image keeps the layout. Rerun only when a drawing changes; the
 * output is deterministic for a given sharp build. Nothing is fetched.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const OUT = path.join(root, "public/email/ticket");
const SIGNAL = "#FF4800";
const INK = "#000000";
const SCALE = 2;

/** 45° stripes clipped to `width` x `height` (CSS px), first bar's foot `offset` px in. */
function stripesSvg(width: number, height: number, offset = 6, bar = 8, pitch = 18): string {
  const bars: string[] = [];
  for (let foot = offset - pitch * 2; foot < width + height; foot += pitch) {
    bars.push(`<polygon points="${foot},${height} ${foot + bar},${height} ${foot + bar + height},0 ${foot + height},0"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${height * SCALE}" viewBox="0 0 ${width} ${height}"><g fill="${SIGNAL}">${bars.join("")}</g></svg>`;
}

/** A half-disc 12 x 24: `left` has its flat edge on the left (the card's left border). */
function notchSvg(side: "left" | "right"): string {
  const cx = side === "left" ? 0 : 12;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${12 * SCALE}" height="${24 * SCALE}" viewBox="0 0 12 24"><rect width="12" height="24" fill="#FFFFFF"/><circle cx="${cx}" cy="12" r="12" fill="${SIGNAL}"/></svg>`;
}

/** A 20 x 20 line icon from 24-unit-grid shapes. */
function iconSvg(shapes: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${20 * SCALE}" height="${20 * SCALE}" viewBox="0 0 24 24" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${shapes}</svg>`;
}

/**
 * Strokes are 1.8 units of the 24-unit grid: 1.5 px at the shown 20 px.
 * Drawn here (no icon set's paths): a calendar with its rings and a day, a
 * map pin, an "i" in a circle.
 */
const ICONS: Record<string, string> = {
  calendar: iconSvg('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/><rect x="7" y="13" width="4" height="4" rx="0.5"/>'),
  pin: iconSvg('<path d="M12 21.5s7-6.2 7-11.5a7 7 0 1 0-14 0c0 5.3 7 11.5 7 11.5z"/><circle cx="12" cy="10" r="2.5"/>'),
  info: iconSvg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.6" r="0.4" fill="#000000"/>'),
};

const png = (svg: string) => sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: false }).toBuffer();

async function main() {
  mkdirSync(OUT, { recursive: true });
  const files: [string, Buffer][] = [
    ["stripes-112.png", await png(stripesSvg(112, 12))],
    ["stripes-72.png", await png(stripesSvg(72, 12))],
    ["notch-left.png", await png(notchSvg("left"))],
    ["notch-right.png", await png(notchSvg("right"))],
    ...(await Promise.all(Object.entries(ICONS).map(async ([name, svg]) => [`${name}.png`, await png(svg)] as [string, Buffer]))),
  ];

  // The wordmark: the official SVG in black on an opaque white plate (the email is white; opaque, so a
  // client that darkens the page anyway keeps a black mark on white rather than losing it).
  const wordmark = readFileSync(path.join(root, "public/brand/sheltuh-wordmark.svg"), "utf8")
    .replace(/fill="currentColor"/, `fill="${INK}"`)
    .replace("<svg ", `<svg width="${106 * SCALE}" height="${24 * SCALE}" preserveAspectRatio="xMidYMid meet" `);
  const wordmarkPng = await sharp(Buffer.from(wordmark)).flatten({ background: "#ffffff" }).png({ compressionLevel: 9 }).toBuffer();
  files.push(["wordmark.png", wordmarkPng]);

  for (const [name, bytes] of files) {
    writeFileSync(path.join(OUT, name), bytes);
    console.log(`public/email/ticket/${name}: ${bytes.length} bytes`);
  }
  writeFileSync(
    path.join(root, "lib/server/email-ticket-wordmark.ts"),
    `// Generated by scripts/render-ticket-email-assets.ts from public/brand/sheltuh-wordmark.svg. Don't edit by hand.

/**
 * The uppercase wordmark in black on white, as a PNG at 2x (212 x 48 px), for the ticket email's header
 * (shown at 106 x 24) and footer (88 x 20). Byte-for-byte public/email/ticket/wordmark.png.
 */
export const TICKET_EMAIL_WORDMARK = {
  displayWidth: 106,
  displayHeight: 24,
  pngBase64:
    "${wordmarkPng.toString("base64")}",
} as const;
`,
  );
  console.log("lib/server/email-ticket-wordmark.ts written");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import LinkQrImage from "@/components/dashboard/LinkQrImage";
import { linkQrMatrix, linkQrPngLayout, linkQrSvg, linkQrVersion } from "@/lib/link-qr";
import { encodePng } from "@/lib/server/png";
import { decodeQrImage } from "./test-utils/qr-decode";

/*
 * Every rendering of an event's poster code (lib/link-qr.ts) decodes with a
 * real decoder (ZXing, tests/test-utils/qr-decode.ts) to exactly the URL it
 * was made from: the downloadable SVG and the page's inline SVG rasterised
 * as vectors at sign and screen sizes, and the PNG's grid (the same
 * whole-pixel squares the browser's canvas draws, lib/link-qr-png.ts) at
 * full size and downscaled as an app or a phone would show it.
 */

const SITES = ["https://sheltuh.com.au", "https://www.sheltuh.com.au", "http://127.0.0.1:3177"];
const SLUG_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_CHARS = "23456789abcdefghjkmnpqrstuvwxyz";

/** Seeded, so a failure names a URL that can be rerun. */
function randomUrls(count: number, seed = 20261126): string[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  const pick = (chars: string) => chars[Math.floor(next() * chars.length)];
  return Array.from({ length: count }, (_, i) => {
    const words = Array.from({ length: 1 + Math.floor(next() * 6) }, () =>
      Array.from({ length: 2 + Math.floor(next() * 12) }, () => pick(SLUG_CHARS)).join(""),
    );
    const slug = words.join("-").slice(0, 87).replace(/-+$/, "");
    const site = SITES[i % SITES.length];
    // Most are tracked (the "QR code" link); every fourth is the plain fallback at the 20-link cap.
    if (i % 4 === 3) return `${site}/events/${slug}`;
    const code = Array.from({ length: 6 + Math.floor(next() * 5) }, () => pick(CODE_CHARS)).join("");
    return `${site}/events/${slug}?ref=${code}`;
  });
}

/** The extremes: the shortest slug, the longest a slug can be (80, "-", 6), both tracked and plain. */
const FIXTURES = [
  "https://sheltuh.com.au/events/x?ref=k7mq2hxd",
  "https://sheltuh.com.au/events/neon-static-warehouse-night?ref=k7mq2hxd",
  `https://sheltuh.com.au/events/${"a".repeat(80)}-3f9c2a?ref=k7mq2hxdzz`,
  `https://sheltuh.com.au/events/${"a".repeat(80)}-3f9c2a`,
];
const URLS = [...FIXTURES, ...randomUrls(56)];

/** An SVG document rasterised as a vector at its own width (`side` px), on white. */
async function rasterise(svg: string, side: number): Promise<Buffer> {
  const png = await sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).png().toBuffer();
  expect((await sharp(png).metadata()).width).toBe(side);
  return png;
}

/** The downloadable SVG at `side` px: its own width and height swapped for the size. */
function fileSvgAt(svg: string, side: number): string {
  return svg.replace(/width="\d+" height="\d+"/, `width="${side}" height="${side}"`);
}

/** The page's and the sign's inline SVG (LinkQrImage) at `side` px. */
function inlineSvgAt(matrix: boolean[][], side: number): string {
  const html = renderToStaticMarkup(<LinkQrImage matrix={matrix} label="QR code" />);
  const svg = html.slice(html.indexOf("<svg"), html.lastIndexOf("</svg>") + 6);
  return svg.replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" `);
}

async function decodesTo(image: Buffer, url: string, what: string, failures: string[]) {
  const decoded = await decodeQrImage(image);
  if (decoded.length !== 1 || decoded[0] !== url) failures.push(`${url} (${what}): ${JSON.stringify(decoded)}`);
}

describe("event poster QR codes decode with ZXing", () => {
  it("every URL is distinct, encodable and within version 10", () => {
    expect(new Set(URLS).size).toBe(URLS.length);
    for (const url of URLS) {
      const matrix = linkQrMatrix(url);
      expect(matrix, url).not.toBeNull();
      expect(linkQrVersion(matrix!)).toBeLessThanOrEqual(10);
    }
  });

  it("the downloadable SVG, rasterised at 240, 354 (A5 sign), 600 and 1200 px (A4 sign at 240 dpi)", async () => {
    const failures: string[] = [];
    for (const url of URLS) {
      const svg = linkQrSvg(linkQrMatrix(url)!);
      for (const side of [240, 354, 600, 1200]) await decodesTo(await rasterise(fileSvgAt(svg, side), side), url, `SVG ${side}px`, failures);
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it("the page's and the sign's inline SVG, at 224 (phone), 256 (desktop) and 600 px", async () => {
    const failures: string[] = [];
    for (const url of URLS) {
      const matrix = linkQrMatrix(url)!;
      for (const side of [224, 256, 600]) await decodesTo(await rasterise(inlineSvgAt(matrix, side), side), url, `inline ${side}px`, failures);
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it("the PNG's grid at full size (about 2000 px) and downscaled with Lanczos to 300 px", async () => {
    const failures: string[] = [];
    for (const url of URLS) {
      const matrix = linkQrMatrix(url)!;
      const { scale, quiet, side } = linkQrPngLayout(matrix.length);
      const png = encodePng(matrix, scale, quiet);
      const meta = await sharp(png).metadata();
      expect(meta.width).toBe(side);
      await decodesTo(png, url, `PNG ${side}px`, failures);
      await decodesTo(await sharp(png).resize(300, 300, { kernel: "lanczos3" }).png().toBuffer(), url, "PNG 300px", failures);
    }
    expect(failures).toEqual([]);
  }, 180_000);

  it("can fail: a code with a third of its modules flipped doesn't decode to the URL", async () => {
    const url = FIXTURES[1];
    const matrix = linkQrMatrix(url)!;
    // Flip a wide band across the middle: past what level Q (or H) can recover.
    const broken = matrix.map((row, y) => row.map((dark, x) => (y > matrix.length / 3 && y < (matrix.length * 2) / 3 && x > 8 ? !dark : dark)));
    const { scale, quiet } = linkQrPngLayout(broken.length);
    expect(await decodeQrImage(encodePng(broken, scale, quiet))).not.toEqual([url]);
  });
});

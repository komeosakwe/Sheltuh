import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import TicketQr from "@/components/tickets/TicketQr";
import { encodePng } from "@/lib/server/png";
import { TICKET_QR_PNG_PX_PER_MODULE, ticketQrPng } from "@/lib/server/qr-image";
import { TICKET_QR_MARK } from "@/lib/server/ticket-qr-mark";
import { TICKET_CODE_ALPHABET, TICKET_CODE_PATTERN, ticketQrPayload } from "@/lib/ticket-code";
import {
  centredSquare,
  clearSquare,
  QR_LOGO_MARK_MODULES,
  QR_QUIET_ZONE_MODULES,
  squareHitsFunctionPatterns,
  ticketQrMatrix,
  ticketQrSymbol,
} from "@/lib/ticket-qr";
import { packBits, rasteriseMark } from "@/scripts/render-ticket-qr-mark";
import { decodeQrImage } from "./test-utils/qr-decode";

/*
 * Every Sheltüh ticket QR carries the ü in its centre (docs/design/ticket-email.md
 * §6). These tests decode the images people actually see with a real decoder
 * (ZXing, tests/test-utils/qr-decode.ts), at every size they're shown at, and
 * prove the test can fail: a logo area that's too big doesn't decode.
 */

/** Seeded, so a failure names a code that can be rerun. */
function randomCodes(count: number, seed = 20261118): string[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state / 2 ** 31;
  };
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 8 }, () => TICKET_CODE_ALPHABET[Math.floor(next() * TICKET_CODE_ALPHABET.length)]);
    return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
  });
}

/** The fixtures the other ticket tests use, plus the alphabet's extremes. */
const FIXTURES = ["7KQM-2HXD", "ABCD-EFGH", "JKLM-NPQR", "K7QM-2XPD", "R4TN-9WJC", "B8VF-3HLZ", "M2GD-6SYA", "BPT7-7P6W", "AAAA-AAAA", "ZZZZ-2222", "9999-9999"];
const CODES = [...FIXTURES, ...randomCodes(200)];

/** The email PNG shown at `side` px: downscaled with Lanczos, as a mail client or the OS would, with no thresholding. */
async function shownAt(png: Buffer, side: number): Promise<Buffer> {
  return side === 528 ? png : sharp(png).resize(side, side, { kernel: "lanczos3" }).png().toBuffer();
}

/** The ticket page's SVG (TicketQr), rasterised as a vector at `side` px on white. */
async function pageQrAt(code: string, side: number): Promise<Buffer> {
  const html = renderToStaticMarkup(<TicketQr code={code} />);
  const svg = html.slice(html.indexOf("<svg"), html.lastIndexOf("</svg>") + 6).replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" `);
  return sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).png().toBuffer();
}

describe("ticket QR codes with the centre ü decode with ZXing", () => {
  it("every code is canonical, and the symbol is version 2 at level H (25 modules, 33 with the quiet zone)", () => {
    expect(new Set(CODES).size).toBe(CODES.length);
    for (const code of CODES) {
      expect(code).toMatch(TICKET_CODE_PATTERN);
      expect(ticketQrMatrix(code)).toHaveLength(25);
    }
  });

  it("the email PNG (528 px) and as shown: 264 (desktop), 231 (phone), 141 (Gmail scaling 600 px onto 320) and 116 (zoomed out 2.2x)", async () => {
    const failures: string[] = [];
    for (const code of CODES) {
      const image = ticketQrPng(code);
      expect(image?.modules).toBe(33);
      for (const side of [528, 264, 231, 141, 116]) {
        const decoded = await decodeQrImage(await shownAt(image!.png, side));
        if (decoded.length !== 1 || decoded[0] !== ticketQrPayload(code)) failures.push(`${code} at ${side}px: ${JSON.stringify(decoded)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it("the ticket page's SVG rasterised at 231 and 264 px, and 151 px (40 mm printed at 96 dpi)", async () => {
    const failures: string[] = [];
    for (const code of CODES) {
      for (const side of [231, 264, 151]) {
        const decoded = await decodeQrImage(await pageQrAt(code, side));
        if (decoded.length !== 1 || decoded[0] !== ticketQrPayload(code)) failures.push(`${code} at ${side}px: ${JSON.stringify(decoded)}`);
      }
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it("the email PNG is the symbol plus the ü: outside the mark, every pixel is its module's", async () => {
    const code = "7KQM-2HXD";
    const { matrix, mark } = ticketQrSymbol(code)!;
    const { data, info } = await sharp(ticketQrPng(code)!.png).greyscale().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([528, 528]);
    const scale = TICKET_QR_PNG_PX_PER_MODULE;
    const q = QR_QUIET_ZONE_MODULES;
    const markFrom = (mark.start + q) * scale;
    let markDark = 0;
    for (let y = 0; y < 528; y++) {
      for (let x = 0; x < 528; x++) {
        const value = data[y * 528 + x];
        expect(value === 0 || value === 255).toBe(true); // pure black or white
        const inMark = x >= markFrom && x < markFrom + 80 && y >= markFrom && y < markFrom + 80;
        if (inMark) {
          if (value === 0) markDark++;
          continue;
        }
        const [mx, my] = [Math.floor(x / scale) - q, Math.floor(y / scale) - q];
        const dark = mx >= 0 && my >= 0 && mx < 25 && my < 25 && matrix[my][mx];
        if ((value === 0) !== dark) throw new Error(`pixel ${x},${y} isn't its module's`);
      }
    }
    // The ü is drawn: a real share of the mark's square is black.
    expect(markDark / (80 * 80)).toBeGreaterThan(0.15);
    expect(markDark / (80 * 80)).toBeLessThan(0.6);
  }, 30_000);

  it("the ü bitmap is still sharp's rendering of public/brand/sheltuh-u.svg (scripts/render-ticket-qr-mark.ts)", async () => {
    const side = QR_LOGO_MARK_MODULES * TICKET_QR_PNG_PX_PER_MODULE;
    expect(TICKET_QR_MARK.side).toBe(side);
    const source = readFileSync(path.join(process.cwd(), "public/brand/sheltuh-u.svg"), "utf8");
    const fresh = packBits(await rasteriseMark(source, side));
    const stored = Buffer.from(TICKET_QR_MARK.bitsBase64, "base64");
    expect(stored.length).toBe(fresh.length);
    // A different renderer build may flip a few half-covered edge pixels; anything more is a different mark.
    let differing = 0;
    for (let i = 0; i < fresh.length; i++) {
      let x = fresh[i] ^ stored[i];
      while (x) {
        differing += x & 1;
        x >>= 1;
      }
    }
    expect(differing / (side * side)).toBeLessThan(0.01);
  });

  it("the logo area never overlaps a function pattern, for any code", () => {
    for (const code of CODES.slice(0, 20)) {
      const { logo } = ticketQrSymbol(code)!;
      expect(squareHitsFunctionPatterns(25, logo)).toBe(false);
    }
  });

  it("negative check: a logo area that's too big (13 × 13 cleared) doesn't decode, so these tests can catch one", async () => {
    let decoded = 0;
    for (const code of CODES.slice(0, 40)) {
      const tooBig = clearSquare(ticketQrMatrix(code)!, centredSquare(25, 13));
      if ((await decodeQrImage(encodePng(tooBig, 16, 4))).length > 0) decoded++;
    }
    expect(decoded).toBe(0);
  }, 30_000);
});

describe("the door's scanner path (lib/check-in/detector.ts, the ZXing WASM it self-hosts)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("reads the email's QR shown at 231 px", async () => {
    const version = readdirSync(path.join(process.cwd(), "public/vendor/zxing-wasm")).find((name) => /^\d+\.\d+\.\d+$/.test(name));
    const wasm = readFileSync(path.join(process.cwd(), "public/vendor/zxing-wasm", version ?? "", "zxing_reader.wasm"));
    // The page fetches /vendor/zxing-wasm/<version>/zxing_reader.wasm from our own origin: serve the self-hosted file.
    const requested: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = input instanceof Request ? input.url : String(input);
      requested.push(url);
      if (!url.endsWith(`/vendor/zxing-wasm/${version}/zxing_reader.wasm`)) throw new Error(`unexpected fetch ${url}`);
      return new Response(new Uint8Array(wasm), { headers: { "content-type": "application/wasm" } });
    });
    // The two browser classes the ponyfill uses that Node doesn't have.
    class TestImageData {
      readonly colorSpace = "srgb";
      constructor(
        readonly data: Uint8ClampedArray,
        readonly width: number,
        readonly height: number,
      ) {}
    }
    class TestDomRect {
      constructor(
        readonly x = 0,
        readonly y = 0,
        readonly width = 0,
        readonly height = 0,
      ) {}
    }
    vi.stubGlobal("ImageData", TestImageData);
    vi.stubGlobal("DOMRectReadOnly", TestDomRect);

    const { loadQrDetector } = await import("@/lib/check-in/detector");
    const detector = await loadQrDetector();
    expect(detector.kind).toBe("wasm");
    expect(requested).toEqual([expect.stringMatching(/\/vendor\/zxing-wasm\/[\d.]+\/zxing_reader\.wasm$/)]);

    for (const code of ["7KQM-2HXD", "BPT7-7P6W", ...randomCodes(10, 7)]) {
      const { data, info } = await sharp(await shownAt(ticketQrPng(code)!.png, 231)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const frame = new TestImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
      // detect() takes the camera's video element at the door; the ponyfill reads ImageData the same way.
      const found = await detector.detect(frame as unknown as HTMLVideoElement);
      expect(found.map((f) => f.rawValue)).toEqual([ticketQrPayload(code)]);
    }
  }, 60_000);
});

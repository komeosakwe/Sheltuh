import { QR_LOGO_MARK_MODULES, QR_QUIET_ZONE_MODULES, ticketQrSymbol } from "@/lib/ticket-qr";
import { encodeBitmapPng } from "./png";
import { TICKET_QR_MARK } from "./ticket-qr-mark";

/**
 * The ticket QR as a PNG, for the ticket email (docs/design/ticket-email.md
 * §6): the symbol from `ticketQrSymbol` (level H, version 2, its centre 7 x 7
 * modules cleared), its 4-module quiet zone, and the brand's ü composited
 * into the centre 5 x 5 modules, black on white, as part of the image (never
 * an overlay a mail client could drop).
 *
 * The ü is the bitmap scripts/render-ticket-qr-mark.ts rasterised from
 * public/brand/sheltuh-u.svg with sharp (lib/server/ticket-qr-mark.ts), so
 * the compositing here is synchronous and the email is built in one pass, as
 * it always has been. Every pixel is pure black or pure white (a 1-bit PNG,
 * lib/server/png.ts), so there's no grey edge for a scanner to misread; the
 * PNG is drawn at 2x the size it's shown at, so the mark looks smooth.
 *
 * tests/ticket-qr-decode.test.ts decodes these images with ZXing at every
 * size they're shown at.
 */

/** Pixels a module in the PNG: 33 modules x 16 = 528 px, shown at 264 (8 px) or 231 (7 px). */
export const TICKET_QR_PNG_PX_PER_MODULE = 16;

if (TICKET_QR_MARK.side !== QR_LOGO_MARK_MODULES * TICKET_QR_PNG_PX_PER_MODULE) {
  throw new Error("lib/server/ticket-qr-mark.ts is out of date: rerun scripts/render-ticket-qr-mark.ts");
}

const MARK_BITS = Buffer.from(TICKET_QR_MARK.bitsBase64, "base64");

/** Whether pixel (x, y) of the ü bitmap is black. */
function markPixel(x: number, y: number): boolean {
  const i = y * TICKET_QR_MARK.side + x;
  return (MARK_BITS[i >> 3] & (0x80 >> (i & 7))) !== 0;
}

/** A ticket QR image: the PNG and its width (= height) in modules, quiet zone included. */
export interface TicketQrPng {
  png: Buffer;
  /** 33 for a version 2 symbol: 25 modules plus 4 each side. */
  modules: number;
}

/** The ticket's QR as a PNG with the ü in its centre, or null for a code that isn't a real one. */
export function ticketQrPng(code: string): TicketQrPng | null {
  const symbol = ticketQrSymbol(code);
  if (!symbol) return null;
  const { matrix, mark } = symbol;
  const scale = TICKET_QR_PNG_PX_PER_MODULE;
  const quiet = QR_QUIET_ZONE_MODULES;
  const modules = matrix.length + quiet * 2;
  const side = modules * scale;
  const markFrom = (mark.start + quiet) * scale;
  const markTo = markFrom + TICKET_QR_MARK.side;
  const png = encodeBitmapPng(side, side, (px, py) => {
    if (px >= markFrom && px < markTo && py >= markFrom && py < markTo) return markPixel(px - markFrom, py - markFrom);
    const mx = Math.floor(px / scale) - quiet;
    const my = Math.floor(py / scale) - quiet;
    return my >= 0 && my < matrix.length && mx >= 0 && mx < matrix.length && matrix[my][mx];
  });
  return { png, modules };
}

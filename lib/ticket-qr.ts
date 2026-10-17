/**
 * The QR code on a ticket, shared by the ticket email (as a PNG,
 * lib/server/png.ts) and the browser (as an SVG path).
 *
 * It encodes `SH1:` plus the code (`ticketQrPayload`, lib/ticket-code.ts) at
 * error-correction level Q (recovers about 25% damage: a cracked screen, a
 * glare spot). The payload is 13 characters of QR's alphanumeric set, so it's
 * always a version 1 symbol: 21 × 21 modules, the smallest and easiest to scan.
 * The encoder is Nayuki's (lib/qr/qrcodegen.ts), verified against independent
 * decoders.
 */
import { qrcodegen } from "@/lib/qr/qrcodegen";
import { TICKET_CODE_PATTERN, ticketQrPayload } from "@/lib/ticket-code";

/** Light modules around the symbol, as the QR standard requires. */
export const QR_QUIET_ZONE_MODULES = 4;

/**
 * The QR modules for a ticket code (`true` = dark), rows top to bottom, with
 * no quiet zone. Null unless `code` is a canonical code (`TICKET_CODE_PATTERN`,
 * upper case with the hyphen): anything else isn't a real ticket, so it gets
 * no QR. Deterministic: the same code always gives the same matrix.
 */
export function ticketQrMatrix(code: string): boolean[][] | null {
  if (typeof code !== "string" || !TICKET_CODE_PATTERN.test(code)) return null;
  const segments = qrcodegen.QrSegment.makeSegments(ticketQrPayload(code));
  // Exactly level Q (boostEcl false), automatic mask.
  const qr = qrcodegen.QrCode.encodeSegments(segments, qrcodegen.QrCode.Ecc.QUARTILE, 1, 40, -1, false);
  return Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => qr.getModule(x, y)));
}

/**
 * One SVG path drawing every dark module, offset by a 4-module quiet zone.
 * Render it as
 *
 *   <svg viewBox={`0 0 ${size} ${size}`} shape-rendering="crispEdges">
 *     <rect width={size} height={size} fill="#fff" />   // the quiet zone must be light
 *     <path d={d} fill="#000" />
 *   </svg>
 *
 * Each horizontal run of dark modules is one rectangle (`M x y h n v 1 h -n z`),
 * on whole units, so it stays crisp at any size. `size` is the matrix's width
 * plus both quiet zones.
 */
export function ticketQrSvgPath(matrix: boolean[][]): { d: string; size: number } {
  const q = QR_QUIET_ZONE_MODULES;
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      const run = x - start;
      parts.push(`M${start + q} ${y + q}h${run}v1h-${run}z`);
    }
  });
  return { d: parts.join(""), size: matrix.length + q * 2 };
}

/** The QR image's alt text / accessible name: "QR code for ticket 7KQM-2HXD". */
export function ticketQrLabel(code: string): string {
  return `QR code for ticket ${code}`;
}

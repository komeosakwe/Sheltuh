/**
 * The QR code on a ticket, shared by the ticket email (as a PNG,
 * lib/server/qr-image.ts) and the browser (as an SVG,
 * components/tickets/TicketQr.tsx). Every Sheltüh ticket QR carries the ü
 * mark in its centre (docs/design/ticket-email.md §6); `ticketQrSymbol` is
 * the one place that decides where it goes, so the email, the ticket page and
 * any later surface (the wallet handoff on My ticket) draw the same symbol.
 *
 * It encodes `SH1:` plus the code (`ticketQrPayload`, lib/ticket-code.ts) at
 * error-correction level H (recovers about 30% damage), which is what lets the
 * code survive the cleared centre. The payload is 13 characters of QR's
 * alphanumeric set; version 1-H holds only 10, so it's always a version 2
 * symbol: 25 × 25 modules. The encoder is Nayuki's (lib/qr/qrcodegen.ts);
 * tests/ticket-qr-decode.test.tsx decodes every image with ZXing.
 */
import { qrcodegen } from "@/lib/qr/qrcodegen";
import { TICKET_CODE_PATTERN, ticketQrPayload } from "@/lib/ticket-code";

/** Light modules around the symbol, as the QR standard requires. */
export const QR_QUIET_ZONE_MODULES = 4;

/** The cleared square in the centre of a ticket QR, in modules: the ü's 5 plus a 1-module light pad all round. */
export const QR_LOGO_CLEAR_MODULES = 7;
/** The square the ü mark is drawn in, in modules, centred inside the cleared square. */
export const QR_LOGO_MARK_MODULES = 5;
/** The largest cleared square a version 2 ticket QR may have (13% of the symbol): never exceed it. */
export const QR_LOGO_MAX_MODULES = 9;

/**
 * The QR modules for a ticket code (`true` = dark), rows top to bottom, with
 * no quiet zone and nothing cleared: the plain symbol (`ticketQrSymbol` adds
 * the logo area). Null unless `code` is a canonical code
 * (`TICKET_CODE_PATTERN`, upper case with the hyphen): anything else isn't a
 * real ticket, so it gets no QR. Deterministic: the same code always gives
 * the same matrix.
 */
export function ticketQrMatrix(code: string): boolean[][] | null {
  if (typeof code !== "string" || !TICKET_CODE_PATTERN.test(code)) return null;
  const segments = qrcodegen.QrSegment.makeSegments(ticketQrPayload(code));
  // Exactly level H (boostEcl false), automatic mask: version 2 for every canonical code.
  const qr = qrcodegen.QrCode.encodeSegments(segments, qrcodegen.QrCode.Ecc.HIGH, 1, 40, -1, false);
  return Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => qr.getModule(x, y)));
}

/** A square of modules: its first row and column (`start`, the same for both) and its side. */
export interface QrSquare {
  start: number;
  size: number;
}

/** The centred square of side `size` in a symbol `symbolSize` modules wide (both odd, so it's exact). */
export function centredSquare(symbolSize: number, size: number): QrSquare {
  if (!Number.isInteger(size) || size < 1 || size > symbolSize || (symbolSize - size) % 2 !== 0) {
    throw new RangeError("A centred square needs a whole, odd-matching side no bigger than the symbol.");
  }
  return { start: (symbolSize - size) / 2, size };
}

/**
 * Which modules of a symbol `size` wide (versions 1 to 6) are function
 * patterns a decoder needs intact (ISO/IEC 18004 §6.3): the three finders with
 * their separators, the timing row and column, the alignment pattern (version
 * 2 and up), both copies of the format information and the always-dark
 * module. Version information only exists from version 7, which a ticket QR
 * never reaches.
 */
export function qrFunctionModules(size: number): boolean[][] {
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > 6) throw new RangeError("Versions 1 to 6 only.");
  const grid = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) grid[y][x] = true;
  };
  // Finders and their separators: an 8 × 8 corner each.
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      mark(i, j);
      mark(size - 1 - i, j);
      mark(i, size - 1 - j);
    }
  }
  // Timing patterns.
  for (let i = 0; i < size; i++) {
    mark(i, 6);
    mark(6, i);
  }
  // The one alignment pattern of versions 2 to 6, centred 7 modules in from the bottom-right corner.
  if (version >= 2) {
    const centre = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(centre + dx, centre + dy);
  }
  // Format information (both copies) and the always-dark module at (8, 4V + 9).
  for (let i = 0; i <= 8; i++) {
    mark(i, 8);
    mark(8, i);
  }
  for (let i = 0; i < 8; i++) {
    mark(size - 1 - i, 8);
    mark(8, size - 1 - i);
  }
  return grid;
}

/** Whether a square of a symbol `size` wide touches any function pattern (`qrFunctionModules`). */
export function squareHitsFunctionPatterns(size: number, square: QrSquare): boolean {
  const fn = qrFunctionModules(size);
  for (let y = square.start; y < square.start + square.size; y++) {
    for (let x = square.start; x < square.start + square.size; x++) if (fn[y]?.[x] !== false) return true;
  }
  return false;
}

/** A copy of `matrix` with `square` set light (`false`). */
export function clearSquare(matrix: boolean[][], square: QrSquare): boolean[][] {
  return matrix.map((row, y) =>
    row.map((dark, x) => (y >= square.start && y < square.start + square.size && x >= square.start && x < square.start + square.size ? false : dark)),
  );
}

/** A ticket QR as every surface draws it: the symbol with its centre cleared, and where the ü goes. */
export interface TicketQrSymbol {
  /** The modules (`true` = dark) with the logo area cleared to light; no quiet zone. */
  matrix: boolean[][];
  /** The cleared square (7 × 7 modules: rows and columns 9 to 15 of a version 2 symbol). */
  logo: QrSquare;
  /** The square the ü mark fills, centred in `logo` with a 1-module light pad (5 × 5). */
  mark: QrSquare;
}

/**
 * The ticket's QR with its centre cleared for the ü mark, or null for a code
 * that isn't a real one. Throws if the cleared square would ever be larger
 * than QR_LOGO_MAX_MODULES or touch a function pattern (finders, timing,
 * alignment, format information): either would make codes unreadable, so it
 * must never ship.
 */
export function ticketQrSymbol(code: string): TicketQrSymbol | null {
  const plain = ticketQrMatrix(code);
  if (!plain) return null;
  const logo = centredSquare(plain.length, QR_LOGO_CLEAR_MODULES);
  if (logo.size > QR_LOGO_MAX_MODULES || squareHitsFunctionPatterns(plain.length, logo)) {
    throw new Error("The QR logo area must stay off the function patterns and within the error budget.");
  }
  return { matrix: clearSquare(plain, logo), logo, mark: centredSquare(plain.length, QR_LOGO_MARK_MODULES) };
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

import type { CSSProperties } from "react";
import { ticketQrLabel, ticketQrMatrix, ticketQrSvgPath } from "@/lib/ticket-qr";

/**
 * Keeps the plate black on white whatever the page does to colour: Windows
 * High Contrast (forced colours), print's "background graphics" setting and
 * browsers' automatic dark modes. All three properties are inherited, so they
 * reach the SVG inside.
 */
const PLATE_STYLE: CSSProperties = {
  forcedColorAdjust: "none",
  printColorAdjust: "exact",
  colorScheme: "only light",
};

/**
 * The scannable QR for a ticket code (docs/design/check-in.md §5.B1): pure
 * black modules on a pure white plate with its 4-module quiet zone. The two
 * colours are SVG presentation attributes, never `currentColor` or theme
 * tokens, so no theme or colour scope can tint them.
 *
 * Plate sizes are whole pixels per module for a version 1 symbol (29 modules
 * with the quiet zone): 203px (7px modules) under 375px wide, 232px (8px)
 * from 375px, and 40mm in print.
 *
 * Renders nothing for a code that isn't a real ticket code
 * (`TICKET_CODE_PATTERN`), so the stub falls back to the text code alone.
 */
export default function TicketQr({ code }: { code: string }) {
  const matrix = ticketQrMatrix(code);
  if (!matrix) return null;
  const { d, size } = ticketQrSvgPath(matrix);
  return (
    <div className="size-[203px] shrink-0 min-[375px]:size-[232px] print:size-[40mm]" style={PLATE_STYLE}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={ticketQrLabel(code)}
        className="block size-full"
      >
        <rect width={size} height={size} fill="#ffffff" />
        <path d={d} fill="#000000" />
      </svg>
    </div>
  );
}

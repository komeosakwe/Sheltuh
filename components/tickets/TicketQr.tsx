import type { CSSProperties } from "react";
import { U_MARK } from "@/components/brand/marks";
import { QR_QUIET_ZONE_MODULES, ticketQrLabel, ticketQrSvgPath, ticketQrSymbol } from "@/lib/ticket-qr";

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
 * The scannable QR for a ticket code (docs/design/check-in.md §5.B1, with the
 * centre ü of docs/design/ticket-email.md §6): pure black modules on a pure
 * white plate with its 4-module quiet zone, the centre 7 × 7 modules cleared
 * (`ticketQrSymbol`, lib/ticket-qr.ts, the same symbol the ticket email's PNG
 * draws) and the brand's ü drawn in black in its middle 5 × 5, as a nested
 * SVG in the same image. The colours are SVG presentation attributes, never
 * `currentColor` or theme tokens, so no theme or colour scope can tint them.
 *
 * Plate sizes are whole pixels per module for a version 2 symbol (33 modules
 * with the quiet zone): 231px (7px modules) under 375px wide, 264px (8px)
 * from 375px, and 40mm in print.
 *
 * Renders nothing for a code that isn't a real ticket code
 * (`TICKET_CODE_PATTERN`), so the stub falls back to the text code alone.
 */
export default function TicketQr({ code }: { code: string }) {
  const symbol = ticketQrSymbol(code);
  if (!symbol) return null;
  const { d, size } = ticketQrSvgPath(symbol.matrix);
  const markAt = symbol.mark.start + QR_QUIET_ZONE_MODULES;
  return (
    <div className="size-[231px] shrink-0 min-[375px]:size-[264px] print:size-[40mm]" style={PLATE_STYLE}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        role="img"
        aria-label={ticketQrLabel(code)}
        className="block size-full"
      >
        <rect width={size} height={size} fill="#ffffff" />
        <path d={d} fill="#000000" data-qr="modules" />
        <svg
          x={markAt}
          y={markAt}
          width={symbol.mark.size}
          height={symbol.mark.size}
          viewBox={U_MARK.viewBox}
          shapeRendering="geometricPrecision"
          aria-hidden="true"
          data-qr="mark"
        >
          {U_MARK.paths.map((p) => (
            <path key={p} d={p} fill="#000000" />
          ))}
        </svg>
      </svg>
    </div>
  );
}

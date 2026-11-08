import type { CSSProperties } from "react";
import { qrcodegen } from "@/lib/qr/qrcodegen";
import { ticketQrSvgPath } from "@/lib/ticket-qr";

/** Pure black on white whatever the theme does (as the ticket QR, components/tickets/TicketQr.tsx). */
const PLATE_STYLE: CSSProperties = { forcedColorAdjust: "none", printColorAdjust: "exact", colorScheme: "only light" };

/** The QR modules for `text` (`true` = dark), at error-correction level Medium. */
export function textQrMatrix(text: string): boolean[][] {
  const qr = qrcodegen.QrCode.encodeText(text, qrcodegen.QrCode.Ecc.MEDIUM);
  return Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => qr.getModule(x, y)));
}

/**
 * A QR code for a campaign link (for a poster or a flyer), drawn as one SVG path
 * on a white plate with the quiet zone the standard requires (4 modules of
 * light all round; ticketQrSvgPath adds it).
 */
export default function CampaignQr({ text, label }: { text: string; label: string }) {
  const { d, size } = ticketQrSvgPath(textQrMatrix(text));
  return (
    <div className="size-48 shrink-0 border border-foreground sm:size-56" style={PLATE_STYLE}>
      <svg viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges" role="img" aria-label={label} className="block size-full">
        <rect width={size} height={size} fill="#ffffff" />
        <path d={d} fill="#000000" />
      </svg>
    </div>
  );
}

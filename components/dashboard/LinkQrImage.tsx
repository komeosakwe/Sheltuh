import { QR_DARK, QR_LIGHT, QR_PLATE_STYLE } from "@/lib/link-qr";
import { ticketQrSvgPath } from "@/lib/ticket-qr";

/**
 * A link's QR code (lib/link-qr.ts) as inline SVG: the white plate with its
 * 4-module quiet zone and one black path, crisp at any size, the colours as
 * SVG attributes so no theme or colour scope can tint them. Size it with
 * `className` (it fills its box).
 */
export default function LinkQrImage({ matrix, label, className = "" }: { matrix: boolean[][]; label: string; className?: string }) {
  const { d, size } = ticketQrSvgPath(matrix);
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className={`block ${className}`.trim()}
      style={QR_PLATE_STYLE}
    >
      <rect width={size} height={size} fill={QR_LIGHT} />
      <path d={d} fill={QR_DARK} data-qr="modules" />
    </svg>
  );
}

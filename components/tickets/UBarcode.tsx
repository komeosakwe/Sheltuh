import { encodeCode128B } from "@/lib/barcode/code128";
import { uBarcodeGeometry } from "@/lib/barcode/u-shape";

/**
 * The ticket's ü: its Code 128 bars bent around a U, with an umlaut above.
 * Every ticket code produces its own shape. Decorative (aria-hidden) — the
 * code itself is always printed as text next to it.
 */
export default function UBarcode({ code, className = "" }: { code: string; className?: string }) {
  const { viewBox, polygons, dots } = uBarcodeGeometry(encodeCode128B(code));
  return (
    <svg aria-hidden="true" viewBox={viewBox} className={className} fill="currentColor">
      {polygons.map((points, i) => (
        <polygon key={i} points={points} />
      ))}
      {dots.map((dot) => (
        <circle key={dot.cx} {...dot} />
      ))}
    </svg>
  );
}

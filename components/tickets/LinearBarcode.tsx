import { encodeCode128B } from "@/lib/barcode/code128";

const QUIET_ZONE_MODULES = 10;

/** A standard straight Code 128 barcode — the scannable one, for door check-in. */
export default function LinearBarcode({ code, className = "" }: { code: string; className?: string }) {
  const modules = encodeCode128B(code);
  const width = modules.length + QUIET_ZONE_MODULES * 2;
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} 40`}
      preserveAspectRatio="none"
      shapeRendering="crispEdges"
      className={className}
      fill="currentColor"
    >
      {Array.from(modules.matchAll(/1+/g), (run) => (
        <rect key={run.index} x={QUIET_ZONE_MODULES + (run.index ?? 0)} y={0} width={run[0].length} height={40} />
      ))}
    </svg>
  );
}

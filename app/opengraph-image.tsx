import { ImageResponse } from "next/og";
import { DOTS_MARK, WORDMARK, type BrandMark } from "@/components/brand/marks";

/**
 * The site-wide share image (docs/design/brand-direction-one.md §4): Signal
 * Orange, the two-dot mark top-left and the uppercase wordmark bottom-left,
 * both black. No live text, so no font is fetched. Absolute URLs come from
 * metadataBase (app/layout.tsx). Statically generated at build time.
 */
export const alt = "Sheltüh";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const MARGIN = 96;

function Mark({ mark, width }: { mark: BrandMark; width: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={mark.viewBox}
      width={width}
      height={Math.round(width / mark.ratio)}
      fill="#000000"
    >
      {mark.paths.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: MARGIN,
          background: "#ff4800",
        }}
      >
        <Mark mark={DOTS_MARK} width={96} />
        <Mark mark={WORDMARK} width={720} />
      </div>
    ),
    size,
  );
}

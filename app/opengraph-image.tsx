import { ImageResponse } from "next/og";
import { BrandCardView } from "@/lib/server/share-card-render";

/**
 * The site-wide share image (docs/design/brand-direction-one.md §4): Signal
 * Orange, the two-dot mark top-left and the uppercase wordmark bottom-left,
 * both black (lib/server/share-card-render.tsx). No live text, so no font is
 * fetched. Absolute URLs come from metadataBase (app/layout.tsx). Statically
 * generated at build time. Pages with nothing of their own inherit it; events
 * and organisers have their own cards (their segments' opengraph-image).
 *
 * No tagline: the brand faces (Instrument Sans) ship only as WOFF2, which
 * Satori can't read, so any text here would be in the default face, not the
 * brand's.
 */
export const alt = "Sheltüh";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(<BrandCardView />, size);
}

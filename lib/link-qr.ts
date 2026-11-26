/**
 * The QR code for a link (docs/architecture.md, "Event QR codes"): an event's
 * poster code, which opens its public page. Pure, so the browser, the tests
 * and any later surface draw the same symbol.
 *
 * Plain on purpose (owner decision, 26 Nov 2026): no centre ü. The ü stays
 * the mark of a ticket (lib/ticket-qr.ts), so a poster is never mistaken for
 * one and the code keeps all of its error correction for a creased, rained-on
 * or badly lit sign.
 *
 * It encodes the URL as given, in byte mode, at error-correction level Q
 * (recovers about 25% damage) or higher: Nayuki's encoder raises the level
 * while the symbol stays the same size. Versions are capped at
 * LINK_QR_MAX_VERSION (57 × 57 modules), so a poster code is never too dense
 * to scan from across a room; anything longer gets no code. An event's
 * tracked URL is version 6 for a typical slug and version 9 for the longest
 * (tests/link-qr.test.ts pins both; tests/link-qr-decode.test.ts decodes
 * every rendering with ZXing).
 */
import type { CSSProperties } from "react";
import { qrcodegen } from "@/lib/qr/qrcodegen";
import { QR_QUIET_ZONE_MODULES, ticketQrSvgPath } from "@/lib/ticket-qr";

/** The densest symbol a link may become. */
export const LINK_QR_MAX_VERSION = 10;

/** The plate and the modules: pure white and pure black, never theme colours (a scanner reads contrast). */
export const QR_LIGHT = "#ffffff";
export const QR_DARK = "#000000";

/**
 * Keeps an inline code's plate black on white whatever the page does to
 * colour (as the ticket QR's, components/tickets/TicketQr.tsx): forced
 * colours, print's "background graphics" setting and automatic dark modes.
 */
export const QR_PLATE_STYLE: CSSProperties = {
  forcedColorAdjust: "none",
  printColorAdjust: "exact",
  colorScheme: "only light",
};

/** The PNG download's largest side, in pixels ("about 2000": big enough for any print shop). */
export const LINK_QR_PNG_MAX_SIDE = 2048;

/** The downloadable SVG's own width and height per module, in px, for apps that need a size (it scales freely). */
export const LINK_QR_SVG_PX_PER_MODULE = 16;

/** An http(s) URL with a host, or null: a QR must never open `javascript:`, `data:` or anything else. */
function webUrl(url: string): URL | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * The QR modules for `url` (`true` = dark), rows top to bottom, with no
 * quiet zone. Null for anything that isn't an http(s) URL, or one too long
 * for LINK_QR_MAX_VERSION. Deterministic: the same URL always gives the same
 * matrix (automatic mask).
 */
export function linkQrMatrix(url: string): boolean[][] | null {
  if (!webUrl(url)) return null;
  let qr: qrcodegen.QrCode;
  try {
    qr = qrcodegen.QrCode.encodeSegments(
      qrcodegen.QrSegment.makeSegments(url),
      qrcodegen.QrCode.Ecc.QUARTILE,
      1,
      LINK_QR_MAX_VERSION,
      -1,
      true,
    );
  } catch {
    // "Data too long": over the version cap.
    return null;
  }
  return Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => qr.getModule(x, y)));
}

/** A matrix's QR version (1 to 40), from its side. */
export function linkQrVersion(matrix: boolean[][]): number {
  return (matrix.length - 17) / 4;
}

/**
 * A standalone SVG file of the code: the white plate (with the 4-module quiet
 * zone the standard requires) and one black path of whole-module rectangles,
 * `shape-rendering="crispEdges"`, so it stays sharp at any size. Nothing
 * else: no text, title, metadata, script, image or external reference, so
 * there's nothing in it that could carry an event's text or run.
 */
export function linkQrSvg(matrix: boolean[][]): string {
  const { d, size } = ticketQrSvgPath(matrix);
  const px = size * LINK_QR_SVG_PX_PER_MODULE;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${px}" height="${px}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="${QR_LIGHT}"/>` +
    `<path d="${d}" fill="${QR_DARK}"/>` +
    `</svg>\n`
  );
}

/** How the PNG is drawn: whole pixels per module, and the image's side (quiet zone included). */
export interface LinkQrPngLayout {
  /** Pixels per module. */
  scale: number;
  /** Light modules on each side. */
  quiet: number;
  /** The image's width and height in pixels. */
  side: number;
}

/**
 * The PNG's layout for a symbol `modules` wide (no quiet zone): the most whole
 * pixels per module that fit LINK_QR_PNG_MAX_SIDE, so every module is an
 * exact square with no blurred edge.
 */
export function linkQrPngLayout(modules: number): LinkQrPngLayout {
  const quiet = QR_QUIET_ZONE_MODULES;
  const total = modules + quiet * 2;
  const scale = Math.max(1, Math.floor(LINK_QR_PNG_MAX_SIDE / total));
  return { scale, quiet, side: scale * total };
}

/**
 * The download's file name: "sheltuh-neon-static-qr.png". Slugs are already
 * `a-z 0-9 -`; anything else is replaced, so a name is always safe to save.
 */
export function eventQrFilename(slug: string, ext: "svg" | "png"): string {
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `sheltuh-${safe || "event"}-qr.${ext}`;
}

/**
 * The address as people read it under the code: no scheme, no `www.`, no
 * query (a tracking link's `?ref=`) and no fragment: "sheltuh.com.au/events/neon-static".
 * Empty for anything that isn't an http(s) URL.
 */
export function displayUrl(url: string): string {
  const parsed = webUrl(url);
  if (!parsed) return "";
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.host.replace(/^www\./, "")}${path}`;
}

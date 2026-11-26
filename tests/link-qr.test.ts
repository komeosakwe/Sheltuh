import { describe, expect, it } from "vitest";
import {
  displayUrl,
  eventQrFilename,
  LINK_QR_MAX_VERSION,
  LINK_QR_PNG_MAX_SIDE,
  linkQrMatrix,
  linkQrPngLayout,
  linkQrSvg,
  linkQrVersion,
} from "@/lib/link-qr";
import { qrcodegen } from "@/lib/qr/qrcodegen";

/*
 * The event poster code (lib/link-qr.ts): plain (no centre ü), level Q or
 * higher, at most version 10, only for http(s) URLs. tests/link-qr-decode.test.ts
 * proves every rendering scans.
 */

const SITE = "https://sheltuh.com.au";
const tracked = (slug: string, code = "k7mq2hxd") => `${SITE}/events/${slug}?ref=${code}`;

/** The level the encoder settled on (it may raise Q to H while the symbol stays the same size). */
function levelOf(url: string): number {
  return qrcodegen.QrCode.encodeSegments(qrcodegen.QrSegment.makeSegments(url), qrcodegen.QrCode.Ecc.QUARTILE, 1, 10, -1, true)
    .errorCorrectionLevel.ordinal;
}

describe("linkQrMatrix", () => {
  it("is deterministic: the same URL always gives the same modules", () => {
    const url = tracked("neon-static-warehouse-night");
    expect(linkQrMatrix(url)).toEqual(linkQrMatrix(url));
    expect(linkQrMatrix(url)).not.toEqual(linkQrMatrix(tracked("neon-static-warehouse-nigh")));
  });

  it("pins the versions: a typical tracked URL (27-character slug) is version 6, the longest slug (87) version 9", () => {
    const typical = linkQrMatrix(tracked("a".repeat(27)));
    expect(typical).toHaveLength(41);
    expect(linkQrVersion(typical!)).toBe(6);
    // slugify keeps 80 characters; a taken slug gets "-" and 6 more (withUniqueSlug).
    const longest = linkQrMatrix(tracked(`${"a".repeat(80)}-${"b".repeat(6)}`));
    expect(linkQrVersion(longest!)).toBe(9);
    // The plain (untracked) URL of the longest slug fits too.
    expect(linkQrVersion(linkQrMatrix(`${SITE}/events/${"a".repeat(87)}`)!)).toBeLessThanOrEqual(9);
  });

  it("is at least level Q (2), and raised to H where it fits in the same size", () => {
    for (const slug of ["x", "night-market", "a".repeat(27), "a".repeat(87)]) {
      expect(levelOf(tracked(slug))).toBeGreaterThanOrEqual(qrcodegen.QrCode.Ecc.QUARTILE.ordinal);
    }
  });

  it("refuses anything past version 10 rather than make a code too dense for a poster", () => {
    expect(LINK_QR_MAX_VERSION).toBe(10);
    expect(linkQrMatrix(`${SITE}/events/${"a".repeat(140)}`)).toBeNull();
  });

  it.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,<script>alert(1)</script>"],
    ["mailto:", "mailto:a@example.com"],
    ["empty", ""],
    ["blank", "   "],
    ["not a URL", "sheltuh.com.au/events/x"],
    ["no host", "https://"],
  ])("refuses %s", (_what, url) => {
    expect(linkQrMatrix(url)).toBeNull();
  });

  it("encodes http as well as https (a local dev origin)", () => {
    expect(linkQrMatrix("http://127.0.0.1:3000/events/x?ref=k7mq2hxd")).not.toBeNull();
  });
});

describe("linkQrSvg", () => {
  const matrix = linkQrMatrix(tracked("night-market"))!;
  const svg = linkQrSvg(matrix);

  it("is a standalone SVG: the viewBox in modules plus the 8 of the quiet zones, a white plate, one black path, crisp edges", () => {
    const side = matrix.length + 8;
    expect(svg.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${side} ${side}"`);
    expect(svg).toContain(`width="${side * 16}" height="${side * 16}"`);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain(`<rect width="${side}" height="${side}" fill="#ffffff"/>`);
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toMatch(/<path d="(M\d+ \d+h\d+v1h-\d+z)+" fill="#000000"\/>/);
    // Every dark module drawn once: the runs' widths add up to the dark count.
    const drawn = [...svg.matchAll(/h(\d+)v1/g)].reduce((sum, m) => sum + Number(m[1]), 0);
    expect(drawn).toBe(matrix.flat().filter(Boolean).length);
  });

  it("carries nothing but the drawing: no text, title, metadata, script, image, link or style", () => {
    for (const tag of ["text", "title", "desc", "metadata", "script", "image", "a", "foreignObject", "style", "use"]) {
      expect(svg).not.toMatch(new RegExp(`<${tag}[\\s>/]`, "i"));
    }
    expect(svg).not.toMatch(/href|on\w+=|url\(/i);
    // Not even the URL it encodes.
    expect(svg).not.toContain("night-market");
  });
});

describe("linkQrPngLayout", () => {
  it("uses whole pixels per module, the quiet zone included, as near 2048 px as fits", () => {
    for (const modules of [21, 37, 41, 53, 57]) {
      const { scale, quiet, side } = linkQrPngLayout(modules);
      expect(Number.isInteger(scale)).toBe(true);
      expect(quiet).toBe(4);
      expect(side).toBe(scale * (modules + 8));
      expect(side).toBeLessThanOrEqual(LINK_QR_PNG_MAX_SIDE);
      expect(side + modules + 8).toBeGreaterThan(LINK_QR_PNG_MAX_SIDE);
    }
    expect(linkQrPngLayout(41)).toEqual({ scale: 41, quiet: 4, side: 2009 });
  });
});

describe("eventQrFilename", () => {
  it("names the file after the event's slug", () => {
    expect(eventQrFilename("neon-static", "png")).toBe("sheltuh-neon-static-qr.png");
    expect(eventQrFilename("neon-static", "svg")).toBe("sheltuh-neon-static-qr.svg");
  });

  it("keeps the name safe whatever the slug holds", () => {
    expect(eventQrFilename("../../etc/passwd", "png")).toBe("sheltuh-etc-passwd-qr.png");
    expect(eventQrFilename("Night Market!", "svg")).toBe("sheltuh-night-market-qr.svg");
    expect(eventQrFilename("", "png")).toBe("sheltuh-event-qr.png");
  });
});

describe("displayUrl", () => {
  it("drops the scheme, www, the ?ref= and any fragment", () => {
    expect(displayUrl(tracked("neon-static"))).toBe("sheltuh.com.au/events/neon-static");
    expect(displayUrl("https://www.sheltuh.com.au/events/neon-static/#tickets")).toBe("sheltuh.com.au/events/neon-static");
    expect(displayUrl("http://127.0.0.1:3177/events/x?ref=abc")).toBe("127.0.0.1:3177/events/x");
  });

  it("is empty for anything that isn't an http(s) URL", () => {
    expect(displayUrl("javascript:alert(1)")).toBe("");
    expect(displayUrl("")).toBe("");
  });
});

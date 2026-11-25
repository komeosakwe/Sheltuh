/**
 * The wallet passes' brand, as the designer's 20 Nov 2026 frames draw them
 * (docs/wallet-setup.md, "What the passes look like"): a white pass with
 * Black values and Black labels (the frames, which win over the handoff's
 * "grey labels"), and Signal Orange only in the marks: Apple's wordmark on
 * the white pass (a logo, not text: about 3.4:1) and the Ü on Black (6.18:1).
 * Shared by both passes and by scripts/render-wallet-images.ts.
 *
 * A pass is static once saved (no web service, no Google API updates), so a
 * pass made before a colour changed here keeps the colours it was made with.
 */
export const WALLET_COLOURS = {
  /** The pass's background. */
  white: "#ffffff",
  /** Values and labels (21:1 on white), and the fill behind the orange marks. */
  ink: "#000000",
  /** The marks only, never text. */
  signal: "#ff4800",
} as const;

/** Apple's pass.json takes colours as `rgb(r, g, b)`. */
export function appleRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff})`;
}

/** The name on every pass (Apple's organizationName, Google's issuerName). */
export const WALLET_ORGANISATION_NAME = "Sheltüh";

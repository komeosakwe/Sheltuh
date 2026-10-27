/**
 * The wallet passes' brand (docs/design/brand-direction-one.md): Black text
 * on the warm ivory the ticket email's column uses (19.8:1), with Signal
 * Orange as a fill only (Apple's strip behind the event name, Google's hero
 * and logo), always with Black on it (6.18:1). Shared by both passes and by
 * scripts/render-wallet-images.ts.
 */
export const WALLET_COLOURS = {
  ivory: "#fdf9e6",
  ink: "#000000",
  /** Secondary text (the email's `muted`): 5.33:1 on ivory. */
  muted: "#6b675e",
  signal: "#ff4800",
} as const;

/** Apple's pass.json takes colours as `rgb(r, g, b)`. */
export function appleRgb(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff})`;
}

/** The name on every pass (Apple's organizationName, Google's issuerName). */
export const WALLET_ORGANISATION_NAME = "Sheltüh";

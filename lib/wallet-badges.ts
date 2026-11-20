/**
 * The vendors' official wallet artwork (docs/wallet-setup.md, "Official
 * badges"), downloaded by the owner on 20 Nov 2026, under
 * public/wallet/badges/. Apple's is byte for byte. Google's has its corner
 * radius cut from a pill to a rounded rectangle like Apple's (the owner's
 * call; docs/wallet-setup.md), nothing else. Never redraw, recolour, crop or
 * otherwise restyle either. The email can't rely on SVG, so it uses PNGs rasterised from these
 * same files (scripts/render-ticket-email-assets.ts,
 * lib/server/email-ticket-layout.ts).
 *
 * Shown as a pair at the same height, Apple's first:
 * - Apple: "Add to Apple Wallet", US/UK English, black. Apple's only badge is
 *   two lines ("Add to / Apple Wallet").
 * - Google: "Add to Google Wallet", Australian English, the two-line
 *   "add-wallet-badge" of Google's pack, chosen to match Apple's at the same
 *   height. Google's one-line button would have type about 40% bigger beside
 *   it, and doesn't fit half a phone-width row.
 *
 * `width` and `height` are each artboard's own size (its SVG width and
 * height), which fixes its proportions.
 */

export type WalletBadgeProvider = "apple" | "google";

export interface WalletBadgeFile {
  /** Path under public/, served from the site's root. */
  src: string;
  width: number;
  height: number;
  /** The vendor's wording, word for word: the image's alt text and the link's accessible name. */
  label: string;
}

export const WALLET_BADGES = {
  apple: { src: "/wallet/badges/US-UK_Add_to_Apple_Wallet_RGB_101421.svg", width: 110.739, height: 35.016, label: "Add to Apple Wallet" },
  google: { src: "/wallet/badges/enAU_add_to_google_wallet_add-wallet-badge.svg", width: 199, height: 55, label: "Add to Google Wallet" },
} as const satisfies Record<WalletBadgeProvider, WalletBadgeFile>;

/** The height both badges are shown at in the ticket email (the design images measure 47.5px at 600). */
export const WALLET_BADGE_EMAIL_HEIGHT = 48;

/**
 * Apple asks for this wherever the badge is shown, because the page or email
 * may be open on a device without Wallet (docs/wallet-setup.md). `where` is
 * "page" on the site and "email" in the ticket email.
 */
export function appleWalletDeviceNote(where: "page" | "email", tickets: number): string {
  return `To add your ${tickets > 1 ? "tickets" : "ticket"} to Apple Wallet, open this ${where} on your iPhone or Mac.`;
}

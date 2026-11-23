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
 * Shown as a pair at the same width, each artwork at its own proportions (so
 * Apple's is a little taller), Apple's first. Stacked, their edges line up; in
 * a row, they're centred on each other. Nothing is drawn around or behind
 * them: an equal box filled to match would leave each artwork's own outline
 * showing inside it (the owner's call, 22 Nov 2026; docs/wallet-setup.md).
 * - Apple: "Add to Apple Wallet", US/UK English, black. Apple's only badge is
 *   two lines ("Add to / Apple Wallet").
 * - Google: "Add to Google Wallet", Australian English, the two-line
 *   "add-wallet-badge" of Google's pack, chosen to match Apple's. Google's
 *   one-line button would have type about 40% bigger beside it, and doesn't
 *   fit half a phone-width row.
 *
 * On the site both are 160px wide (components/tickets/WalletButtons.tsx):
 * Google's at 44px tall (199 x 55 scaled: 159.2), the wider of the pair at
 * that height, so it keeps a 44px touch target; Apple's is then about 51px
 * tall (110.739 x 35.016 scaled: 50.6).
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

/**
 * The width both badges are shown at in the ticket email: Google's at the
 * design's 48px tall (199 x 55 scaled: 173.7), the wider of the pair at that
 * height. Apple's is then 55px tall (110.739 x 35.016 scaled: 55.0).
 */
export const WALLET_BADGE_EMAIL_WIDTH = 174;

/** The same on a phone (in the email's `.wb` rule): Google's at 46px tall (166.4), so each fits half the row. */
export const WALLET_BADGE_EMAIL_PHONE_WIDTH = 166;

/** A badge's height at `width`, at its artwork's own proportions, to the nearest pixel. */
export function walletBadgeHeight(provider: WalletBadgeProvider, width: number): number {
  const badge = WALLET_BADGES[provider];
  return Math.round((width * badge.height) / badge.width);
}

/**
 * Apple asks for this wherever the badge is shown, because the page or email
 * may be open on a device without Wallet (docs/wallet-setup.md). `where` is
 * "page" on the site and "email" in the ticket email.
 */
export function appleWalletDeviceNote(where: "page" | "email", tickets: number): string {
  return `To add your ${tickets > 1 ? "tickets" : "ticket"} to Apple Wallet, open this ${where} on your iPhone or Mac.`;
}

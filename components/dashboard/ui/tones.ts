/**
 * The dashboard's soft tones (Latte's dashboard frames: KEY-SPECS §0), each one of the category
 * tag tints in app/globals.css (`[data-tag]`: a Light pair, and a Dark pair in Dark and on ink,
 * each at least 4.5:1, tests/tag-contrast.test.ts):
 *
 * - green (`pop-up`): Live, Paid, On sale, ↑ %, Checked in, Paid out this year
 * - red (`theatre`): Sold out, ↓ %, Cancel event
 * - lilac (`live-music`): Transferred, Scheduled, Payout pending, Transfers
 * - yellow (`fashion`): Processing, Refunds this year
 * - grey (`neutral`): Draft, Ended, Free, Not yet
 */
export type DashTone = "green" | "red" | "lilac" | "yellow" | "grey";

export const TONE_TAG: Record<DashTone, string> = {
  green: "pop-up",
  red: "theatre",
  lilac: "live-music",
  yellow: "fashion",
  grey: "neutral",
};

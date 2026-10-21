import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
// import localFont from "next/font/local"; // brand-direction-one.md §3.4: uncomment when Bootzy arrives

/**
 * The brand faces (docs/design/brand-direction-one.md §3.1), self-hosted by
 * next/font with size-adjusted fallbacks. Both are preloaded: Instrument
 * titles and Plex Mono dates sit above the fold on cards. `latin` includes ü.
 * app/globals.css maps them to --face-sans and --face-mono.
 */

/** Instrument Sans, variable weight 400–700: body, headings, buttons, nav. */
export const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

/** IBM Plex Mono 400 and 500: eyebrows, straps, dates and references. */
export const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

/*
 * Bootzy, the display face, isn't licensed into the repo yet; --face-display
 * falls back to Instrument Sans 700 set tight. When the licensed files land:
 * 1. add app/fonts/bootzy/Bootzy-Regular.woff2 (and its licence file);
 * 2. uncomment the import above and this export, and add `${bootzy.variable}`
 *    to <html className> in app/layout.tsx;
 * 3. flip the display block in app/globals.css :root (§3.4).
 *
 * export const bootzy = localFont({
 *   variable: "--font-bootzy",
 *   src: [{ path: "./fonts/bootzy/Bootzy-Regular.woff2", weight: "400", style: "normal" }],
 *   display: "swap",
 *   adjustFontFallback: "Arial",
 *   preload: true,
 * });
 */

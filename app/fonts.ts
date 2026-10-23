import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import localFont from "next/font/local";

/**
 * The brand faces (docs/design/brand-direction-one.md §3.1), self-hosted by
 * next/font with size-adjusted fallbacks. All are preloaded: Instrument
 * titles and Plex Mono dates sit above the fold on cards, and the home's
 * search field is in the plain face. `latin` includes ü. app/globals.css maps
 * them to --face-sans (dotted, then plain), --face-sans-plain and --face-mono.
 */

/**
 * Instrument Sans, variable weight 400–700, unmodified. It's --face-sans-plain:
 * form fields (what people type looks the way they typed it), and any
 * character outside the dotted font's latin subset.
 */
export const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Instrument Sans Dots (CSS family `instrumentDots`): the same latin Instrument Sans file with the plain
 * vowels a e i o u A E I O U drawn as ä ë ï ö ü Ä Ë Ï Ö Ü (owner request,
 * 23 Oct 2026: the brand's dots over every vowel). Only the rendering
 * changes; the text stays plainly spelled. Body, headings, buttons and nav,
 * via --face-sans. Built by scripts/build-dotted-font.py, OFL 1.1; see
 * app/fonts/instrument-sans-dots/README.md.
 *
 * No size-adjusted Arial fallback of its own (adjustFontFallback: false), so
 * until it loads, and for any character it lacks, the text falls through to
 * Instrument Sans and its fallback in --face-sans.
 */
export const instrumentDots = localFont({
  variable: "--font-instrument-dots",
  src: [{ path: "./fonts/instrument-sans-dots/InstrumentSansDots-latin.woff2", weight: "400 700", style: "normal" }],
  // The CSS family name. next/font/local names the --font-instrument-dots variable after this
  // export, so the @font-face must use the same name or nothing would match it.
  declarations: [{ prop: "font-family", value: "instrumentDots" }],
  display: "swap",
  adjustFontFallback: false,
  preload: true,
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
 * 2. uncomment this export, and add `${bootzy.variable}`
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

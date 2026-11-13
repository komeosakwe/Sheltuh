import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import localFont from "next/font/local";

/**
 * The brand faces (the redesign rules' Type board), self-hosted by next/font.
 * Bootzy and Instrument Sans are preloaded: display headlines, card titles and
 * dates sit above the fold. IBM Plex Mono is no longer a text face (owner
 * decision, 13 Nov 2026): it's kept only for machine codes, so it isn't
 * preloaded. app/globals.css maps them to --face-sans, --face-mono and
 * --face-display.
 */

/** Instrument Sans, variable weight 400–700: UI, headings, body, buttons, nav and form fields. */
export const instrument = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin"],
  display: "swap",
});

/**
 * IBM Plex Mono 400, for machine codes only (`font-mono`): the ticket's
 * entry code, order references, the door's code entry and admin links that
 * carry a token, where 0 and O or 1 and l must be told apart. Dates, times,
 * places and eyebrows are Instrument Sans. Not preloaded: only the ticket,
 * check-in and admin pages use it, and the browser fetches it there when a
 * code is drawn.
 */
export const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400"],
  subsets: ["latin"],
  display: "swap",
  preload: false,
});

/**
 * Bootzy (Bootzy TM, Regular only), the display face: the display-* type
 * styles only, never body, buttons or labels. The owner-supplied file,
 * converted from its OTF to WOFF2 unchanged (app/fonts/bootzy/README.md).
 *
 * `adjustFontFallback: false`: next/font/local's default puts a
 * size-adjusted Arial face right after Bootzy, so the glyphs Bootzy lacks
 * (· … * ~ → × and the no-break space) would draw in Arial. Without it they
 * fall through --face-display to Instrument Sans. One weight (400), and
 * globals.css sets `font-synthesis-weight: none` on every display style, so
 * a bold heading never gets a smeared fake bold.
 */
export const bootzy = localFont({
  variable: "--font-bootzy",
  src: [{ path: "./fonts/bootzy/Bootzy-Regular.woff2", weight: "400", style: "normal" }],
  display: "swap",
  adjustFontFallback: false,
  preload: true,
});

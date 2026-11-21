import type { InlineImage } from "./email";
import { escapeHtml, WORDMARK_CID } from "./email-layout";
import { TICKET_EMAIL_WORDMARK } from "./email-ticket-wordmark";

/**
 * The ticket email's own look (docs/design/ticket-email.md): white, black
 * type, Signal Orange as the ticket's frame, notches and stripes and the
 * primary button's fill, and a darker orange (#D03E00, 4.8:1 on white) for
 * the two small orange texts (owner decision P1). Instrument Sans and IBM
 * Plex Mono, self-hosted on the site's own https origin (never a third-party
 * font host), with Arial / Courier New where a client ignores web fonts
 * (Gmail, Outlook). Light only.
 *
 * Bulletproof markup: `role="presentation"` tables, `bgcolor` beside every
 * background, inline styles on every cell (the desktop values), and a
 * `@media (max-width:620px)` block of short classes for the phone values; a
 * client that ignores the media query (the Gmail app with a non-Google
 * account) shows the fluid desktop layout, which scales down because every
 * width is `width:100%; max-width:…`. Outlook for Windows gets a fixed 600px
 * wrapper and `mso-padding-alt` on the buttons; it drops the radii, which is
 * acceptable.
 *
 * Only lib/server/ticket-email.ts uses this; the other emails keep
 * email-layout.ts and email-modern-layout.ts.
 */

export const TICKET_EMAIL_COLOURS = {
  /** The page, the column and the ticket's inside. */
  white: "#ffffff",
  /** Text, the perforation, the outline button and chips' strokes (21:1 on white). */
  ink: "#000000",
  /** Signal Orange: the ticket's border, notches and stripes, the primary button (black text on it, 6.18:1). Never small text. */
  signal: "#ff4800",
  /** The order label and the venue line: small orange text at 4.8:1 on white (owner decision P1). */
  signalText: "#d03e00",
  /** Secondary text: 6.69:1 on white, 6.48:1 on cream. */
  muted: "#5c5c5c",
  /** Hairline dividers. */
  line: "#e5e3de",
  /** The info rows' icon circles. */
  surface: "#f2f1ee",
  /** The "Going with friends?" box. */
  cream: "#fffae7",
} as const;

export const SANS = `'Instrument Sans',Arial,Helvetica,sans-serif`;
export const MONO = `'IBM Plex Mono','Courier New',monospace`;

/** The self-hosted faces (public/fonts/…, OFL; the same files the site's next/font serves). */
export const TICKET_EMAIL_FONTS = {
  sans: "/fonts/instrument-sans/InstrumentSans-latin-wght.woff2",
  mono400: "/fonts/ibm-plex-mono/IBMPlexMono-400-latin.woff2",
  mono500: "/fonts/ibm-plex-mono/IBMPlexMono-500-latin.woff2",
  mono600: "/fonts/ibm-plex-mono/IBMPlexMono-600-latin.woff2",
} as const;

/** The decorative PNGs, hosted on the site's origin (scripts/render-ticket-email-assets.ts draws them at 2x). */
export const TICKET_EMAIL_ASSETS = {
  stripesDesktop: "/email/ticket/stripes-112.png",
  stripesPhone: "/email/ticket/stripes-72.png",
  notchLeft: "/email/ticket/notch-left.png",
  notchRight: "/email/ticket/notch-right.png",
  calendar: "/email/ticket/calendar.png",
  pin: "/email/ticket/pin.png",
  info: "/email/ticket/info.png",
} as const;

/**
 * The vendors' official wallet badges as PNGs (email clients can't be relied
 * on for SVG), rasterised unmodified from the committed SVGs
 * (lib/wallet-badges.ts) by scripts/render-ticket-email-assets.ts at 2x and
 * 3x, transparent outside the badge. Both are shown 48px tall (the design
 * images measure 47.5 at 600), at their own proportions: Apple's 152 wide
 * (110.739 x 35.016 scaled: 151.8) and Google's two-line badge 174 wide
 * (199 x 55 scaled: 173.7). On a phone both are 46px tall (`.wb`), so
 * Google's fits half of the row.
 */
export const TICKET_EMAIL_WALLET_BADGES = {
  apple: { x2: "/email/ticket/apple-wallet-badge@2x.png", x3: "/email/ticket/apple-wallet-badge@3x.png", width: 152, height: 48 },
  google: { x2: "/email/ticket/google-wallet-badge@2x.png", x3: "/email/ticket/google-wallet-badge@3x.png", width: 174, height: 48 },
} as const;

/** The site's https origin, or null (a local http dev server gets no web fonts). */
function httpsOrigin(siteUrl: string): string | null {
  try {
    const site = new URL(siteUrl);
    return site.protocol === "https:" ? site.origin : null;
  } catch {
    return null;
  }
}

/** A hosted asset's absolute URL: the site's origin plus its path. */
export function ticketAssetUrl(siteUrl: string, assetPath: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${assetPath}`;
}

/** `@font-face` for the self-hosted faces on an https site, else nothing (the fallbacks alone). */
export function ticketFontFace(siteUrl: string): string {
  const origin = httpsOrigin(siteUrl);
  if (!origin) return "";
  const face = (family: string, weight: string, file: string) =>
    `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:swap;src:url('${origin}${file}') format('woff2')}\n`;
  return (
    face("Instrument Sans", "400 700", TICKET_EMAIL_FONTS.sans) +
    face("IBM Plex Mono", "400", TICKET_EMAIL_FONTS.mono400) +
    face("IBM Plex Mono", "500", TICKET_EMAIL_FONTS.mono500) +
    face("IBM Plex Mono", "600", TICKET_EMAIL_FONTS.mono600)
  );
}

/**
 * The phone values (≤620px), as classes on the elements whose inline style
 * holds the desktop value. Kept short: Gmail clips a message over 102KB.
 */
const MOBILE_CSS = `@media only screen and (max-width:620px){
.pg{padding:34px 16px 40px 16px!important}
.h1{font-size:22px!important;line-height:28px!important}
.tx{padding-left:16px!important;padding-right:16px!important}
.pf{padding-left:4px!important;padding-right:4px!important}
.g16{padding-top:18px!important}.g25{padding-top:25px!important}.gp{padding-top:24px!important}
.gl{padding-bottom:10px!important}.gv{padding-top:8px!important}
.tt{font-size:22px!important;line-height:28px!important}
.tv{font-size:10px!important;line-height:14px!important}
.sv{font-size:13px!important;line-height:20px!important}
.sc{width:92px!important}
.qr{width:231px!important;height:231px!important}
.ei{max-height:144px!important}
.sd{display:none!important}
.wb{width:auto!important;height:46px!important}
.sm{display:block!important;width:72px!important;height:14px!important;max-height:none!important;overflow:visible!important}
.bt{padding:14px 4px!important}
.bo{padding:12.5px 4px!important}
.bl{padding-right:4px!important}.br{padding-left:4px!important}
.wt{width:100%!important}.wh{width:50%!important}.wa{width:auto!important}
}`;

export interface TicketEmailPageInput {
  /** The document title (plain text). */
  title: string;
  /** Inbox preview text (plain text), hidden in the body (Outlook included: `mso-hide:all`). */
  preheader: string;
  /** The site's origin: the web fonts are declared only for an https one. */
  siteUrl: string;
  /** The column's contents (trusted markup), top to bottom. */
  body: string;
}

/** The page: white all round, one column of at most 600px, 32px sides (16px on a phone). */
export function ticketEmailPage({ title, preheader, siteUrl, body }: TicketEmailPageInput): string {
  const { white, ink } = TICKET_EMAIL_COLOURS;
  return `<!DOCTYPE html>
<html lang="en-AU" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(title)}</title>
<style>
${ticketFontFace(siteUrl)}:root{color-scheme:light;supported-color-schemes:light}
body{margin:0;padding:0}table{border-collapse:collapse}img{border:0;outline:none}a{color:${ink}}
${MOBILE_CSS}
</style>
<!--[if mso]><style>body,table,td,p,a,h1,h2,span{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body bgcolor="${white}" style="margin:0;padding:0;background-color:${white};font-family:${SANS};color:${ink};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${white}" style="background-color:${white}">
<tr><td align="center">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${white}" class="column" style="width:100%;max-width:600px;background-color:${white}">
<tr><td class="pg" align="left" style="padding:34px 32px 40px 32px;font-family:${SANS};color:${ink}">
${body}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

/** Blocks one under another, each followed by its gap (px). Spacing is cell padding, which Outlook honours. */
export function stack(blocks: ReadonlyArray<readonly [html: string, gapAfterPx: number]>): string {
  const shown = blocks.filter(([html]) => html !== "");
  const rows = shown
    .map(([html, gap], i) => `<tr><td style="padding:0 0 ${i === shown.length - 1 ? 0 : gap}px 0">${html}</td></tr>`)
    .join("\n");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">\n${rows}\n</table>`;
}

/** A 1px hairline in the dividers' colour. */
export function hairline(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="${TICKET_EMAIL_COLOURS.line}" style="height:1px;font-size:0;line-height:0;background-color:${TICKET_EMAIL_COLOURS.line}">&nbsp;</td></tr></table>`;
}

/** The wordmark, inline (`cid:`), at `width` x `height` (106 x 24 in the header, 88 x 20 in the footer). */
export function wordmarkTag(width: number, height: number): string {
  return `<img src="cid:${WORDMARK_CID}" width="${width}" height="${height}" alt="Sheltüh" style="display:block;border:0;width:${width}px;height:${height}px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:700;color:${TICKET_EMAIL_COLOURS.ink}">`;
}

/** The wordmark's inline attachment: Signal Orange on transparent. Its name is the brand's, never anything about the order. */
export function ticketWordmarkImage(): InlineImage {
  return {
    cid: WORDMARK_CID,
    contentType: "image/png",
    content: Buffer.from(TICKET_EMAIL_WORDMARK.pngBase64, "base64"),
    filename: "sheltuh.png",
  };
}

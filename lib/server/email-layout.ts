import { SUPPORT_EMAIL } from "@/lib/contact";

/**
 * The one look every transactional email shares (Brand Direction One,
 * docs/design/brand-direction-one.md §2): black on cream and white, one white
 * card with a black hairline, and Signal Orange only as the fill of the one
 * call-to-action, with black text on it (6.18:1; white on orange fails for
 * button text). Used by the ticket, free-ticket confirmation, waitlist and
 * follower emails, so they can't drift apart again.
 *
 * Email-client safe: table layout, inline styles, `bgcolor` attributes beside
 * `background-color` (the body's too), an Outlook (mso) width wrapper, a
 * button that keeps its size in Outlook for Windows (`mso-padding-alt`), a
 * preheader hidden there as well (`mso-hide:all`), no web fonts (the stack
 * names Instrument Sans for anyone who has it installed and falls back to
 * system faces), and light only (`color-scheme: light only`, as the site).
 */

export const EMAIL_COLOURS = {
  /** Page background (brand Cream). */
  cream: "#fffae7",
  /** The card (brand White). */
  card: "#ffffff",
  /** Text, rules, the card's hairline, text on orange (brand Black). */
  ink: "#000000",
  /** Secondary text: 5.39:1 on cream, 5.63:1 on white. */
  muted: "#6b675e",
  /** Decorative dividers only (the site's `--surface-border`). */
  line: "#ddd5ba",
  /** Signal Orange: the primary button's fill, nothing else. */
  signal: "#ff4800",
} as const;

export const CREAM = EMAIL_COLOURS.cream;
export const CARD = EMAIL_COLOURS.card;
export const INK = EMAIL_COLOURS.ink;
export const MUTED = EMAIL_COLOURS.muted;
export const LINE = EMAIL_COLOURS.line;
export const SIGNAL = EMAIL_COLOURS.signal;

export const SANS = `'Instrument Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif`;
export const MONO = `'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The email's h1. `html` is trusted markup (escape anything dynamic first). */
export function heading(html: string, gapAfterPx = 16): string {
  return `<h1 style="margin:0 0 ${gapAfterPx}px 0;font-family:${SANS};font-size:28px;line-height:34px;font-weight:bold;color:${INK}">${html}</h1>`;
}

/** The event's title: black, bold, 20px (never orange or blue). */
export function eventTitle(title: string, gapAfterPx = 4): string {
  return `<p style="margin:0 0 ${gapAfterPx}px 0;font-family:${SANS};font-size:20px;line-height:26px;font-weight:bold;color:${INK}">${escapeHtml(title)}</p>`;
}

/**
 * The event's title, then one line each for `lines` (plain text, e.g. when
 * and where; empty ones are left out). The last element gets `gapAfterPx`.
 */
export function eventBlock(title: string, lines: string[], gapAfterPx = 24): string {
  const shown = lines.filter((line) => line.trim() !== "");
  return (
    eventTitle(title, shown.length === 0 ? gapAfterPx : 4) +
    shown
      .map(
        (line, i) =>
          `<p style="margin:0 0 ${i === shown.length - 1 ? gapAfterPx : 4}px 0;font-family:${SANS};font-size:16px;line-height:24px;color:${INK}">${escapeHtml(line)}</p>`,
      )
      .join("")
  );
}

/**
 * The one call-to-action: Signal Orange fill, black label, black hairline.
 * 14px padding on a 20px line plus the border makes it 50px tall (≥44px).
 * Outlook for Windows ignores padding on an <a>, so the cell carries the same
 * padding as `mso-padding-alt` (read by Outlook only) and the button keeps
 * its size there; everywhere else the padding is on the block-level <a>, so
 * the whole button is the link.
 */
export function button(label: string, href: string, margin = "0 0 24px 0"): string {
  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${margin}"><tr>` +
    `<td bgcolor="${SIGNAL}" style="background-color:${SIGNAL};border:1px solid ${INK};border-radius:8px;mso-padding-alt:14px 28px">` +
    `<a href="${escapeHtml(href)}" style="display:block;padding:14px 28px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:bold;color:${INK};text-decoration:none">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

/** The line under the card on every email. */
export const supportFooter = `Need help? Email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(SUPPORT_EMAIL)}</a><br>Sheltüh &middot; Melbourne`;

export interface PageInput {
  /** The document title (plain text). */
  title: string;
  /** The card's contents (trusted markup). */
  body: string;
  /** Inbox preview text (plain text), hidden in the body (Outlook desktop included: it needs `mso-hide:all`). */
  preheader?: string;
  /** Markup above the card, e.g. the ticket email's logo row. */
  header?: string;
  /** Markup under the card. Defaults to the support line. */
  footer?: string;
  /** Markup after the footer, full card width, e.g. the ticket email's banner. */
  after?: string;
}

/** The brand email page: cream, one white card with a black hairline, the support line under it. */
export function page({ title, body, preheader, header, footer = supportFooter, after }: PageInput): string {
  return `<!DOCTYPE html>
<html lang="en-AU" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(title)}</title>
<style>
  @media only screen and (max-width: 620px) {
    .px { padding-left: 18px !important; padding-right: 18px !important; }
    .code { font-size: 24px !important; letter-spacing: 2px !important; }
  }
</style>
</head>
<body bgcolor="${CREAM}" style="margin:0;padding:0;background-color:${CREAM};font-family:${SANS};color:${INK};-webkit-text-size-adjust:100%">
${preheader ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;color:${CREAM};font-size:1px;line-height:1px">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>\n` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CREAM}" style="background-color:${CREAM}">
<tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
${header ? `  <tr><td align="left" style="padding:0 4px 16px 4px">${header}</td></tr>\n` : ""}  <tr><td bgcolor="${CARD}" class="px" style="background-color:${CARD};border:1px solid ${INK};border-radius:12px;padding:32px 30px;font-family:${SANS};color:${INK}">
${body}
  </td></tr>
  <tr><td align="center" style="padding:16px 12px 0 12px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${footer}</td></tr>
${after ? `  <tr><td style="padding:20px 0 0 0">${after}</td></tr>\n` : ""}</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

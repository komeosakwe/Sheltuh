import { SUPPORT_EMAIL } from "@/lib/contact";
import { emailFontFace, escapeHtml, SANS } from "./email-layout";
import { eventImageEmailUrl } from "./ticket-email";

/**
 * The warm, rounded look of the event reminder and the organiser announcement
 * ("Message ticket holders"): ivory ground, near-black type, one orange
 * accent, 1px warm borders, 16px cards, an 8px spacing scale and a 600px
 * column, with no gradients, shadows or decoration.
 *
 * It sits beside lib/server/email-layout.ts and shares nothing with it but
 * the font stack, the escaping and the @font-face, so the ticket, onboarding,
 * waitlist, follower, review and invite emails (which use EMAIL_COLOURS and
 * `page()`) render exactly as before. Everything is table-based and inline
 * styled for Gmail, Outlook and Apple Mail: Outlook ignores radius and
 * margins, which only soften there (spacing is cell padding, not margin; the
 * buttons carry `mso-padding-alt`), and `color-scheme: light` keeps clients
 * from inverting it. The images are hosted PNGs on the site's own origin
 * (the wordmark in public/brand, the icons in public/email/icons, drawn by
 * scripts/render-email-icons.ts); with images blocked, their alt text shows.
 */

export const MODERN_COLOURS = {
  /** The page and the column: warm ivory. */
  bg: "#FFF9E8",
  /** Text, the outline button's border and its label, and the label on orange (17.5:1 on ivory). */
  ink: "#171411",
  /** The accent: a fill for the primary button only, always with ink text (5.5:1), never as text. */
  accent: "#FF4D00",
  /** Hairlines and card borders. */
  border: "#E9E1CC",
  /** Secondary text (the address, the footer): 5.7:1 on ivory, 5.4:1 on the message card's tint. */
  muted: "#6A6256",
  /** The announcement's message card. */
  tint: "#FFF1E6",
  tintBorder: "#F5D9C4",
} as const;

const { bg: BG, ink: INK, accent: ACCENT, border: BORDER, muted: MUTED } = MODERN_COLOURS;

/** Column width, CSS px. */
export const COLUMN_WIDTH = 600;
/** Side padding, so the content is 552px wide (see `.px` for phones). */
const SIDE = 24;
export const CONTENT_WIDTH = COLUMN_WIDTH - SIDE * 2;

export const WORDMARK_PATH = "/brand/sheltuh-wordmark-email.png";
/** The wordmark's pixel size is 212 x 48 (2x); shown at half, or 80 x 18 in the footer. */
const WORDMARK_SIZE = { width: 106, height: 24 } as const;
const FOOTER_WORDMARK_SIZE = { width: 80, height: 18 } as const;

export const ICON_PATHS = {
  calendar: "/email/icons/calendar.png",
  clock: "/email/icons/clock.png",
  pin: "/email/icons/pin.png",
} as const;
export type EmailIcon = keyof typeof ICON_PATHS;

/** A hosted asset's URL: the site's origin plus its path (used as is on a local http site too). */
export function emailAssetUrl(siteUrl: string, assetPath: string): string {
  return `${siteUrl.replace(/\/+$/, "")}${assetPath}`;
}

/** Text styles: size/line-height in px, weight 400 unless said, ink unless said. */
export function textStyle(size: number, line: number, options: { weight?: 400 | 600; colour?: string; extra?: string } = {}): string {
  const { weight = 400, colour = INK, extra = "" } = options;
  return `font-family:${SANS};font-size:${size}px;line-height:${line}px;font-weight:${weight};color:${colour}${extra ? `;${extra}` : ""}`;
}

/** The email's h1: 36/44, weight 600 (30/36 on a phone via `.h1`). `html` is trusted markup. */
export function modernHeading(html: string): string {
  return `<h1 class="h1" style="margin:0;${textStyle(36, 44, { weight: 600, extra: "letter-spacing:normal;overflow-wrap:break-word;word-wrap:break-word" })}">${html}</h1>`;
}

/** A paragraph: 16/24 by default. `html` is trusted markup. */
export function modernParagraph(html: string, style = textStyle(16, 24)): string {
  return `<p style="margin:0;${style}">${html}</p>`;
}

/** Blocks one under another, each followed by its gap (px, on the 8px scale). Spacing is cell padding, which Outlook honours. */
export function stack(blocks: ReadonlyArray<readonly [html: string, gapAfterPx: number]>): string {
  const rows = blocks
    .filter(([html]) => html !== "")
    .map(([html, gap], i, all) => `<tr><td style="padding:0 0 ${i === all.length - 1 ? 0 : gap}px 0">${html}</td></tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

/**
 * The shared header: the Sheltüh wordmark at the top left (a hosted PNG with
 * explicit size) and a small category label in an outlined pill at the right.
 */
export function brandHeader(siteUrl: string, label: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="left" valign="middle" style="font-family:${SANS}">` +
    `<img src="${escapeHtml(emailAssetUrl(siteUrl, WORDMARK_PATH))}" width="${WORDMARK_SIZE.width}" height="${WORDMARK_SIZE.height}" alt="Sheltüh" style="display:block;border:0;width:${WORDMARK_SIZE.width}px;height:${WORDMARK_SIZE.height}px;${textStyle(18, 24, { weight: 600 })}">` +
    `</td>` +
    `<td align="right" valign="middle">` +
    `<table role="presentation" align="right" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td bgcolor="${BG}" style="background-color:${BG};border:1px solid ${BORDER};border-radius:999px;padding:4px 12px;${textStyle(13, 20, { weight: 600, colour: MUTED, extra: "white-space:nowrap" })}">${escapeHtml(label)}</td>` +
    `</tr></table>` +
    `</td></tr></table>`
  );
}

/**
 * The event's artwork across the column's content, 16px radius, or "" when
 * there is none (or the site isn't https, or the path isn't one of the
 * site's own: `eventImageEmailUrl`). `imagePath` is the event's stored image
 * path (EventRecord.imageUrl). Its height follows the picture (not stored).
 */
export function coverImage(siteUrl: string, imagePath: string | undefined, alt: string): string {
  const url = eventImageEmailUrl(siteUrl, imagePath);
  if (!url) return "";
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td bgcolor="${BG}" style="background-color:${BG};border-radius:16px;overflow:hidden;font-size:0;line-height:0">` +
    `<img src="${escapeHtml(url)}" width="${CONTENT_WIDTH}" alt="${escapeHtml(alt)}" style="display:block;border:0;border-radius:16px;width:100%;max-width:100%;height:auto;${textStyle(14, 20, { colour: MUTED })}">` +
    `</td></tr></table>`
  );
}

/** One of the small line icons, 20 x 20 shown from a 40 x 40 PNG. `alt` is its meaning for a screen reader or blocked images. */
export function icon(siteUrl: string, name: EmailIcon, alt: string): string {
  return `<img src="${escapeHtml(emailAssetUrl(siteUrl, ICON_PATHS[name]))}" width="20" height="20" alt="${escapeHtml(alt)}" style="display:block;border:0;width:20px;height:20px;${textStyle(12, 20, { colour: MUTED })}">`;
}

/**
 * The call to action: a full-width orange fill with an ink label (5.5:1), 16px
 * of padding on a 20px line (54px tall), 12px radius. Outlook for Windows
 * ignores padding on an <a>, so the cell repeats it as `mso-padding-alt`.
 */
export function primaryButton(label: string, href: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" bgcolor="${ACCENT}" style="background-color:${ACCENT};border:1px solid ${ACCENT};border-radius:12px;mso-padding-alt:16px 24px">` +
    `<a href="${escapeHtml(href)}" style="display:block;padding:16px 24px;${textStyle(16, 20, { weight: 600, extra: "text-decoration:none;text-align:center" })}">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

/** The secondary action: full width, ivory with a 1px ink outline and an ink label, the same size as the primary. */
export function outlineButton(label: string, href: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td align="center" bgcolor="${BG}" style="background-color:${BG};border:1px solid ${INK};border-radius:12px;mso-padding-alt:16px 24px">` +
    `<a href="${escapeHtml(href)}" style="display:block;padding:16px 24px;${textStyle(16, 20, { weight: 600, extra: "text-decoration:none;text-align:center" })}">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

/**
 * The compact footer, under a hairline: the support address, why the reader
 * got this email (`reason`, plain text), a Privacy policy link, the small
 * wordmark with "Creative event discovery", and "Sheltüh · Melbourne".
 */
export function compactFooter(input: { reason: string; siteUrl: string }): string {
  const { reason, siteUrl } = input;
  const small = textStyle(12, 18, { colour: MUTED });
  const link = `color:${MUTED};text-decoration:underline`;
  const privacy = new URL("/privacy", siteUrl).href;
  const row = (html: string, top: number) => `<tr><td style="padding:${top}px 0 0 0;${small}">${html}</td></tr>`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="border-top:1px solid ${BORDER};padding:24px 0 0 0;${small}">Need help? Email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="${link}">${escapeHtml(SUPPORT_EMAIL)}</a></td></tr>` +
    row(escapeHtml(reason), 8) +
    row(`<a href="${escapeHtml(privacy)}" style="${link}">Privacy policy</a>`, 8) +
    `<tr><td style="padding:24px 0 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td valign="middle" style="padding:0 12px 0 0"><img src="${escapeHtml(emailAssetUrl(siteUrl, WORDMARK_PATH))}" width="${FOOTER_WORDMARK_SIZE.width}" height="${FOOTER_WORDMARK_SIZE.height}" alt="Sheltüh" style="display:block;border:0;width:${FOOTER_WORDMARK_SIZE.width}px;height:${FOOTER_WORDMARK_SIZE.height}px;${textStyle(14, 18, { weight: 600 })}"></td>` +
    `<td valign="middle" style="${small}">Creative event discovery</td>` +
    `</tr></table></td></tr>` +
    row("Sheltüh &middot; Melbourne", 8) +
    `</table>`
  );
}

export interface ModernPageInput {
  /** The document title (plain text). */
  title: string;
  /** Inbox preview text (plain text), hidden in the body (Outlook included: `mso-hide:all`). */
  preheader?: string;
  /** The site's origin: when https, the head declares the self-hosted Nunito, else the fallback stack alone. */
  siteUrl: string;
  /** The column's contents (trusted markup): the header through the footer, usually a `stack`. */
  body: string;
}

/** The page: ivory all round, one column of at most 600px, 24px sides (16px on a phone, ≤620px). */
export function modernPage({ title, preheader, siteUrl, body }: ModernPageInput): string {
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
${emailFontFace(siteUrl)}  :root { color-scheme: light; supported-color-schemes: light; }
  @media only screen and (max-width: 620px) {
    .outer { padding: 16px 0 !important; }
    .px { padding-left: 16px !important; padding-right: 16px !important; }
    .h1 { font-size: 30px !important; line-height: 36px !important; }
  }
</style>
<!--[if mso]><style>body, table, td, p, a, h1, h2, span { font-family: 'Segoe UI', Arial, sans-serif !important; }</style><![endif]-->
</head>
<body bgcolor="${BG}" style="margin:0;padding:0;background-color:${BG};font-family:${SANS};color:${INK};-webkit-text-size-adjust:100%">
${preheader ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>\n` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" style="background-color:${BG}">
<tr><td align="center" class="outer" style="padding:32px 16px">
<!--[if mso]><table role="presentation" width="${COLUMN_WIDTH}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BG}" class="column" style="width:100%;max-width:${COLUMN_WIDTH}px;background-color:${BG}">
  <tr><td class="px" align="left" style="padding:0 ${SIDE}px;${textStyle(16, 24)}">
${body}
  </td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

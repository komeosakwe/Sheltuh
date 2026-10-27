import { SUPPORT_EMAIL } from "@/lib/contact";
import type { InlineImage } from "./email";
import { EMAIL_WORDMARK } from "./email-wordmark";

/**
 * The one look every transactional email shares: black type on a warm ivory
 * column (the cream of the owner's email banner, so the footer banner sits on
 * it seamlessly), framed by a slightly darker warm page, and Signal Orange
 * only ever as a fill carrying black text (6.18:1; white on orange fails for
 * text), never as text. Used by the ticket, free-ticket confirmation,
 * waitlist, follower, admin review and invite emails, so they can't drift
 * apart.
 *
 * Email-client safe: table layout, inline styles, `bgcolor` attributes beside
 * `background-color` (the body's too), an Outlook (mso) 600px width wrapper,
 * a button that keeps its size in Outlook for Windows (`mso-padding-alt`), a
 * preheader hidden there as well (`mso-hide:all`), a system font stack (no
 * web fonts; Outlook for Windows is pinned to Segoe UI / Arial so it never
 * falls back to Times), no flex or grid, no background images, and light only
 * (`color-scheme: light only`): every surface sets its own background, so a
 * client that forces a dark mode anyway still keeps black type on a light
 * fill, and the ticket QR on its own white panel.
 */

export const EMAIL_COLOURS = {
  /** The page around the column: a warm frame. */
  page: "#f1ede1",
  /** The column (warm ivory, the owner's banner cream): black on it is 19.8:1. */
  card: "#fdf9e6",
  /** Pure white: the ticket panel, so each QR sits on white. */
  white: "#ffffff",
  /** Text, borders, text on orange (brand Black). */
  ink: "#000000",
  /** Secondary text and the ticket's dashed perforation: 5.33:1 on the column, 5.65:1 on white. */
  muted: "#6b675e",
  /** Decorative rules only (the site's `--surface-border`). */
  line: "#dedcd5",
  /** Signal Orange: a fill only (the button, the ticket email's label), always with black text. */
  signal: "#ff4800",
} as const;

export const PAGE = EMAIL_COLOURS.page;
export const CARD = EMAIL_COLOURS.card;
export const WHITE = EMAIL_COLOURS.white;
export const INK = EMAIL_COLOURS.ink;
export const MUTED = EMAIL_COLOURS.muted;
export const LINE = EMAIL_COLOURS.line;
export const SIGNAL = EMAIL_COLOURS.signal;

/**
 * The brand's type: Nunito Sans where the reader has it installed, then close
 * system matches. No web font is loaded (no @import, no Google Fonts), so a
 * client without Nunito simply uses Avenir Next, Segoe UI or Arial. Outlook
 * for Windows is pinned to Segoe UI / Arial in the page's mso block.
 */
export const SANS = `'Nunito Sans','Nunito','Avenir Next','Segoe UI',Arial,sans-serif`;
export const MONO = `'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace`;

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The email's h1 (36/44, 600; 30/36 at 620px and under via `.h1`). `html` is trusted markup (escape anything dynamic first). */
export function heading(html: string, gapAfterPx = 16): string {
  return `<h1 class="h1" style="margin:0 0 ${gapAfterPx}px 0;font-family:${SANS};font-size:36px;line-height:44px;font-weight:600;letter-spacing:normal;color:${INK}">${html}</h1>`;
}

/** The main heading from plain text lines (escaped), one per line: "Find your room." / "Find your people." */
export function displayHeading(lines: string | string[], gapAfterPx = 24): string {
  const list = Array.isArray(lines) ? lines : [lines];
  return heading(list.map(escapeHtml).join("<br>"), gapAfterPx);
}

/** A section heading (h2): 22/28, weight 500. Plain text, escaped. */
export function sectionHeading(text: string, gapAfterPx = 16): string {
  return `<h2 style="margin:0 0 ${gapAfterPx}px 0;font-family:${SANS};font-size:22px;line-height:28px;font-weight:500;letter-spacing:normal;color:${INK}">${escapeHtml(text)}</h2>`;
}

/** A body paragraph: 16/24, weight 400. `html` is trusted markup; use `paragraph` for plain text. */
export function paragraphHtml(html: string, gapAfterPx = 16): string {
  return `<p style="margin:0 0 ${gapAfterPx}px 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:400;color:${INK}">${html}</p>`;
}

/** A body paragraph from plain text (escaped). */
export function paragraph(text: string, gapAfterPx = 16): string {
  return paragraphHtml(escapeHtml(text), gapAfterPx);
}

/** A restrained 1px rule between sections, with `marginPx` of space above and below. */
export function divider(marginPx = 32): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td height="${marginPx}" style="height:${marginPx}px;font-size:1px;line-height:1px">&nbsp;</td></tr>` +
    `<tr><td height="1" style="height:1px;font-size:1px;line-height:1px;border-top:1px solid ${LINE}">&nbsp;</td></tr>` +
    `<tr><td height="${marginPx}" style="height:${marginPx}px;font-size:1px;line-height:1px">&nbsp;</td></tr>` +
    `</table>`
  );
}

export interface NumberedStep {
  title: string;
  /** Plain text. */
  description: string;
  /** An optional text link under the description (an absolute https URL). */
  link?: { label: string; href: string };
}

const stepNumber = (index: number) => String(index + 1).padStart(2, "0");

/** Steps numbered 01, 02, 03 as real black text; the title at weight 500, then the description. */
export function numberedSteps(steps: NumberedStep[]): string {
  const rows = steps
    .map(
      (step, i) =>
        `<tr><td width="44" valign="top" style="width:44px;padding:0 0 20px 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:500;color:${INK}">${stepNumber(i)}</td>` +
        `<td valign="top" style="padding:0 0 20px 0;font-family:${SANS};color:${INK}">` +
        `<p style="margin:0 0 4px 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:500;color:${INK}">${escapeHtml(step.title)}</p>` +
        `<p style="margin:0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:400;color:${INK}">${escapeHtml(step.description)}</p>` +
        (step.link
          ? `<p style="margin:4px 0 0 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:400;color:${INK}"><a href="${escapeHtml(step.link.href)}" style="color:${INK};text-decoration:underline">${escapeHtml(step.link.label)}</a></p>`
          : "") +
        `</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

/** The same steps as plain text, links included. */
export function numberedStepsText(steps: NumberedStep[]): string {
  return steps
    .map((step, i) =>
      [`${stepNumber(i)} ${step.title}`, `   ${step.description}`, ...(step.link ? [`   ${step.link.label}: ${step.link.href}`] : [])].join("\n"),
    )
    .join("\n\n");
}

/**
 * An optional full-width image for the top of the column. https only, with an
 * explicit size and alt text. Not used yet (no licensed photography).
 */
export function heroImage(input: { src: string; alt: string; width: number; height: number }): string {
  if (!/^https:\/\//i.test(input.src)) throw new Error("heroImage needs an https URL");
  return `<img src="${escapeHtml(input.src)}" width="${input.width}" height="${input.height}" alt="${escapeHtml(input.alt)}" style="display:block;border:0;width:100%;max-width:${input.width}px;height:auto;font-family:${SANS};font-size:14px;line-height:20px;color:${INK}">`;
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
 * 14px padding on a 20px line plus the border makes it 50px tall (≥48px),
 * 12px radius, label at weight 500. One per email.
 * Outlook for Windows ignores padding on an <a>, so the cell carries the same
 * padding as `mso-padding-alt` (read by Outlook only) and the button keeps
 * its size there; everywhere else the padding is on the block-level <a>, so
 * the whole button is the link. `fullWidth`: the button spans the column
 * (an easy target on a phone).
 */
export function button(label: string, href: string, margin = "0 0 24px 0", fullWidth = false): string {
  return (
    `<table role="presentation"${fullWidth ? ' width="100%"' : ""} cellpadding="0" cellspacing="0" border="0" style="margin:${margin}"><tr>` +
    `<td bgcolor="${SIGNAL}" style="background-color:${SIGNAL};border:1px solid ${INK};border-radius:12px;mso-padding-alt:14px 28px">` +
    `<a href="${escapeHtml(href)}" style="display:block;padding:14px 28px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:500;color:${INK};text-decoration:none;text-align:center">${escapeHtml(label)}</a>` +
    `</td></tr></table>`
  );
}

const supportFooterLine = `Need help? Email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(SUPPORT_EMAIL)}</a>`;

/** The support line at the foot of every email. */
export const supportFooter = `Need help? Email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(SUPPORT_EMAIL)}</a><br>Sheltüh &middot; Melbourne`;

// --- Brand images ---

/**
 * The footer image: the owner's black SHELTÜH wordmark and "CREATIVE EVENT
 * DISCOVERY" on Signal Orange (public/brand/sheltuh-email-footer.png, 600 x
 * 337, about 12 KB), served by this app from the site's own origin
 * (NEXT_PUBLIC_SITE_URL), so it ships with every deploy. It's the same for
 * everyone and carries no order data, so a hosted image (unlike the QR codes)
 * is fine, and it's decorative: a client blocking remote images shows its alt
 * text instead.
 */
export const EMAIL_FOOTER_IMAGE_PATH = "/brand/sheltuh-email-footer.png";
/** Shown at half its pixel size (sharp at 2x): 300 x 169, its own 600:337 ratio. */
export const EMAIL_FOOTER_IMAGE_WIDTH = 300;
export const EMAIL_FOOTER_IMAGE_HEIGHT = 169;
export const EMAIL_FOOTER_IMAGE_ALT = "Sheltüh — Creative event discovery";

/** The footer image's absolute URL on an https site, or null (a local http dev server: the alt text is shown as text instead). */
export function emailFooterImageUrl(siteUrl: string): string | null {
  try {
    const site = new URL(siteUrl);
    return site.protocol === "https:" ? new URL(EMAIL_FOOTER_IMAGE_PATH, site.origin).href : null;
  } catch {
    return null;
  }
}

/** The wordmark's inline attachment. Its name is the brand's, never anything about the order. */
export const WORDMARK_CID = "sheltuh-wordmark@sheltuh.com.au";

/**
 * The official uppercase wordmark (lib/server/email-wordmark.ts, black on an
 * opaque plate of the column's ivory), attached inline (`cid:`) so it shows
 * where remote images are blocked. Send `wordmarkImage()` with any email that
 * uses this markup.
 */
export const wordmarkHtml = `<img src="cid:${WORDMARK_CID}" width="${EMAIL_WORDMARK.displayWidth}" height="${EMAIL_WORDMARK.displayHeight}" alt="SHELT&Uuml;H" style="display:block;border:0;width:${EMAIL_WORDMARK.displayWidth}px;height:${EMAIL_WORDMARK.displayHeight}px;font-family:${SANS};font-size:20px;line-height:24px;font-weight:bold;color:${INK}">`;

export function wordmarkImage(): InlineImage {
  return {
    cid: WORDMARK_CID,
    contentType: "image/png",
    content: Buffer.from(EMAIL_WORDMARK.pngBase64, "base64"),
    filename: "sheltuh.png",
  };
}

/**
 * The branded footer: an optional lead line (trusted markup, e.g. the support
 * line), a thin rule, the footer image centred (from `siteUrl`, an https
 * origin; its alt text as text otherwise), and "Sheltüh · Melbourne". One
 * footer image per email, inside the column.
 */
export function brandFooter(siteUrl: string, leadHtml?: string): string {
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    (leadHtml
      ? `<tr><td style="padding:0 0 20px 0;font-family:${SANS};font-size:15px;line-height:22px;color:${INK}">${leadHtml}</td></tr>`
      : "") +
    `<tr><td align="center" style="border-top:1px solid ${LINE};padding:24px 0 8px 0">${footerBannerHtml(siteUrl)}</td></tr>` +
    `<tr><td align="center" style="padding:0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">Sheltüh &middot; Melbourne</td></tr>` +
    `</table>`
  );
}

/** The orange footer banner (the only footer banner), or its alt text as text on a non-https site. */
export function footerBannerHtml(siteUrl: string): string {
  const imageUrl = emailFooterImageUrl(siteUrl);
  return imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" width="${EMAIL_FOOTER_IMAGE_WIDTH}" height="${EMAIL_FOOTER_IMAGE_HEIGHT}" alt="${escapeHtml(EMAIL_FOOTER_IMAGE_ALT)}" style="display:block;border:0;width:${EMAIL_FOOTER_IMAGE_WIDTH}px;max-width:100%;height:auto;font-family:${SANS};font-size:14px;line-height:20px;font-weight:500;color:${INK}">`
    : `<span style="font-family:${SANS};font-size:14px;line-height:20px;font-weight:500;color:${INK}">${escapeHtml(EMAIL_FOOTER_IMAGE_ALT)}</span>`;
}

/**
 * The one footer for the newer emails: the support line, why the reader got
 * this email (`reason`, plain text), a privacy link, the orange banner and
 * "Sheltüh · Melbourne". `siteUrl` is the site's https origin.
 */
export function emailFooter(input: { reason: string; siteUrl: string }): string {
  const { reason, siteUrl } = input;
  const small = `font-family:${SANS};font-size:13px;line-height:20px;font-weight:400;color:${MUTED}`;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="border-top:1px solid ${LINE};padding:24px 0 0 0;${small}">${supportFooterLine}</td></tr>` +
    `<tr><td style="padding:8px 0 0 0;${small}">${escapeHtml(reason)}</td></tr>` +
    `<tr><td style="padding:8px 0 0 0;${small}"><a href="${escapeHtml(new URL("/privacy", siteUrl).href)}" style="color:${MUTED};text-decoration:underline">Privacy policy</a></td></tr>` +
    `<tr><td align="center" style="padding:24px 0 8px 0">${footerBannerHtml(siteUrl)}</td></tr>` +
    `<tr><td align="center" style="${small}">Sheltüh &middot; Melbourne</td></tr>` +
    `</table>`
  );
}

/** The plain-text twin of `emailFooter`: support, reason, privacy link, "Sheltüh · Melbourne". */
export function emailFooterText(input: { reason: string; siteUrl: string }): string {
  return [
    "--",
    `Need help? Email ${SUPPORT_EMAIL}`,
    input.reason,
    `Privacy policy: ${new URL("/privacy", input.siteUrl).href}`,
    "Sheltüh · Melbourne",
  ].join("\n");
}

export interface PageInput {
  /** The document title (plain text). */
  title: string;
  /** The column's main contents (trusted markup). */
  body: string;
  /** Inbox preview text (plain text), hidden in the body (Outlook desktop included: it needs `mso-hide:all`). */
  preheader?: string;
  /** Markup at the top of the column, above the body, e.g. the wordmark and heading. */
  header?: string;
  /** Markup spanning the column's full width (no side padding) between the header and the body, e.g. an event image. */
  hero?: string;
  /** Markup at the foot of the column, under a rule. Defaults to the support line. */
  footer?: string;
  /** The site's origin. When https, the head declares the self-hosted Nunito (public/fonts/nunito); otherwise the fallback stack alone. */
  siteUrl?: string;
}

export const EMAIL_FONT_PATH = "/fonts/nunito/Nunito-VariableFont_wght.ttf";

/** `@font-face` for the self-hosted Nunito (variable, 400-600) on an https site, else nothing. Never a third-party font host. */
export function emailFontFace(siteUrl: string | undefined): string {
  if (!siteUrl) return "";
  try {
    const site = new URL(siteUrl);
    if (site.protocol !== "https:") return "";
    return `  @font-face { font-family: 'Nunito'; font-style: normal; font-weight: 400 600; font-display: swap; src: url('${new URL(EMAIL_FONT_PATH, site.origin).href}') format('truetype'); }\n`;
  } catch {
    return "";
  }
}

/**
 * The brand email page: one centred ivory column, at most 600px wide, on the
 * warm page; on a phone (≤620px) the column fills the screen with 20px sides.
 */
export function page({ title, body, preheader, header, hero, footer, siteUrl }: PageInput): string {
  const footerRow = footer
    ? `  <tr><td class="px" style="padding:0 32px 28px 32px;font-family:${SANS};color:${INK}">${footer}</td></tr>\n`
    : `  <tr><td class="px" style="padding:0 32px 28px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid ${LINE};padding:18px 0 0 0;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">${supportFooter}</td></tr></table></td></tr>\n`;
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
${emailFontFace(siteUrl)}  :root { color-scheme: light only; supported-color-schemes: light only; }
  @media only screen and (max-width: 620px) {
    .outer { padding: 0 !important; }
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    .h1 { font-size: 30px !important; line-height: 36px !important; }
    .tpx { padding-left: 14px !important; padding-right: 14px !important; }
  }
</style>
<!--[if mso]><style>body, table, td, p, a, h1, h2, span { font-family: 'Segoe UI', Arial, sans-serif !important; }</style><![endif]-->
</head>
<body bgcolor="${PAGE}" style="margin:0;padding:0;background-color:${PAGE};font-family:${SANS};color:${INK};-webkit-text-size-adjust:100%">
${preheader ? `<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>\n` : ""}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${PAGE}" style="background-color:${PAGE}">
<tr><td align="center" class="outer" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CARD}" class="column" style="width:100%;max-width:600px;background-color:${CARD}">
${header ? `  <tr><td class="px" style="padding:28px 32px 0 32px;font-family:${SANS};color:${INK}">${header}</td></tr>\n` : ""}${hero ? `  <tr><td style="padding:24px 0 0 0">${hero}</td></tr>\n` : ""}  <tr><td class="px" style="padding:${header || hero ? 24 : 32}px 32px 28px 32px;font-family:${SANS};color:${INK}">
${body}
  </td></tr>
${footerRow}</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

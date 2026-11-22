import { SUPPORT_EMAIL } from "@/lib/contact";
import { escapeHtml } from "./email-layout";
import { MONO, SANS, TICKET_EMAIL_ASSETS, ticketAssetUrl, ticketFontFace, wordmarkTag } from "./email-ticket-layout";

/**
 * The one layout every customer and organiser email shares, built to the
 * designer's 20 Nov ("1120") frames: a white 600px column on a cream
 * (customer) or warm grey (organiser) page, the orange wordmark, an orange
 * mono eyebrow over a bold heading, notice boxes with a 1px black outline,
 * detail rows with a round grey icon tile, the 56px orange call to action
 * with an arrow (48px on a phone) beside a white outlined one, "Need a
 * hand?" and the shared footer; plus the organiser pieces (black hero panel,
 * cream step cards with black number badges, stat tiles, sign-off) and the
 * compact Ticket card the reminder uses. The full ticket with its QR stays
 * the ticket email's own orange-outline card (ticketCard in ./ticket-email).
 *
 * Instrument Sans and IBM Plex Mono, self-hosted on the site's own https
 * origin (ticketFontFace), with Arial / Courier New where a client ignores web
 * fonts. Email-client safe: `role="presentation"` tables, inline styles (the
 * desktop values), `bgcolor` beside every background, an Outlook 600px
 * wrapper and `mso-padding-alt` on the buttons, and one `@media
 * (max-width:620px)` block of short `k*` classes for the phone values (the
 * 375 frames: the column edge to edge with 16px sides, a 22/28 heading, 48px
 * buttons). A client that ignores the media query gets the fluid desktop
 * layout, which still fits because every width is `100%` with a max. Light
 * only. Footer lines wrap, centred, rather than clip.
 *
 * Every builder passes plain text through `escapeHtml` before it reaches
 * these helpers, except where a parameter says it takes trusted markup.
 */

export const KIT = {
  white: "#ffffff",
  black: "#000000",
  orange: "#ff4800",
  /** text/secondary */
  muted: "#5c5c5c",
  /** border/subtle */
  line: "#e5e3de",
  /** surface/muted: the organiser page, the icon tiles. */
  surface: "#f2f1ee",
  /** brand/cream: the customer page, the step cards, the stat tiles, "Going with friends?". */
  cream: "#fffae7",
} as const;

export type EmailTone = "customer" | "organiser";

const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;
const FULL = `${TABLE} width="100%"`;

/** A text style: family, size / line height, weight, colour, and anything extra. */
export function kitType(family: "sans" | "mono", size: number, line: number, weight: number, colour: string, extra = ""): string {
  return `font-family:${family === "sans" ? SANS : MONO};font-size:${size}px;line-height:${line}px;font-weight:${weight};color:${colour}${extra ? `;${extra}` : ""}`;
}

/** A paragraph with no margin. `html` is trusted markup. */
export function kitP(html: string, style: string, cls = ""): string {
  return `<p${cls ? ` class="${cls}"` : ""} style="margin:0;${style}">${html}</p>`;
}

/** An underlined link in `colour`. `labelHtml` is trusted markup. */
export function kitLink(href: string, labelHtml: string, colour: string = KIT.black, extra = ""): string {
  return `<a href="${escapeHtml(href)}" style="color:${colour};text-decoration:underline;text-underline-offset:2px${extra ? `;${extra}` : ""}">${labelHtml}</a>`;
}

const WRAP = "overflow-wrap:break-word;word-wrap:break-word";

/** Blocks one under another, `gap` px apart (cell padding, which Outlook honours). Empty blocks are left out. */
export function kitStack(blocks: ReadonlyArray<string>, gap = 32): string {
  const shown = blocks.filter((b) => b !== "");
  return (
    `<table ${FULL}>` +
    shown.map((b, i) => `<tr><td style="padding:0 0 ${i === shown.length - 1 ? 0 : gap}px 0">${b}</td></tr>`).join("") +
    `</table>`
  );
}

// --- The page ---

/** The phone values (≤620px). Short class names: Gmail clips a message over 102KB. */
const KIT_PHONE_CSS = `.ko{padding:24px 0 32px 0!important}
.kp{padding:32px 16px!important}
.kh{font-size:22px!important;line-height:28px!important}
.kbp{padding:12px!important;font-size:16px!important;line-height:24px!important}
.kbs{padding:10.5px 12px!important;font-size:16px!important;line-height:24px!important}
.kl{padding-right:4px!important}.kr{padding-left:4px!important}
.kw{width:100%!important}`;

export interface KitPageInput {
  /** The document title (plain text). */
  title: string;
  /** Inbox preview text (plain text), hidden in the body and padded so the inbox doesn't pull in body copy. */
  preheader: string;
  /** The site's origin: web fonts are declared only for an https one. */
  siteUrl: string;
  /** The column's contents (trusted markup). */
  body: string;
  tone: EmailTone;
  /** More phone rules (no media query around them), e.g. the full ticket's. */
  phoneCss?: string;
}

/** The page: a white column of at most 600px (32px padding) on the tone's page colour; on a phone, the column edge to edge with 16px sides. */
export function kitPage({ title, preheader, siteUrl, body, tone, phoneCss = "" }: KitPageInput): string {
  const bg = tone === "customer" ? KIT.cream : KIT.surface;
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
body{margin:0;padding:0}table{border-collapse:collapse}img{border:0;outline:none}a{color:${KIT.black}}
@media only screen and (max-width:620px){
${KIT_PHONE_CSS}
${phoneCss}
}
</style>
<!--[if mso]><style>body,table,td,p,a,h1,h2,span{font-family:Arial,sans-serif!important}</style><![endif]-->
</head>
<body bgcolor="${bg}" style="margin:0;padding:0;background-color:${bg};font-family:${SANS};color:${KIT.black};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px">${escapeHtml(preheader)}${"&nbsp;&zwnj;".repeat(40)}</div>
<table ${FULL} bgcolor="${bg}" style="background-color:${bg}">
<tr><td align="center" class="ko" style="padding:24px 24px 32px 24px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table ${FULL} bgcolor="${KIT.white}" style="width:100%;max-width:600px;background-color:${KIT.white}">
<tr><td class="kp" align="left" style="padding:32px;font-family:${SANS};color:${KIT.black}">
${body}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

// --- Shared pieces ---

/** The orange wordmark, top left (inline `cid:`: send ticketWordmarkImage() with the email). */
export function kitHeader(): string {
  return wordmarkTag(106, 24);
}

/** The customer intro: an orange mono eyebrow (left out when empty) over a bold heading (24/32; 22/28 on a phone). Plain text. */
export function kitIntro(eyebrow: string, heading: string): string {
  return kitStack(
    [
      eyebrow ? kitP(escapeHtml(eyebrow), kitType("mono", 14, 20, 500, KIT.orange, `letter-spacing:0.56px;${WRAP}`)) : "",
      `<h1 class="kh" style="margin:0;${kitType("sans", 24, 32, 700, KIT.black, WRAP)}">${escapeHtml(heading)}</h1>`,
    ],
    8,
  );
}

/**
 * Body copy: 16/24 black, or `muted` (15/22, text/secondary) for the quieter
 * lines (expiry, "Didn't ask for this?"). `html` is trusted markup.
 */
export function kitText(html: string, options: { muted?: boolean } = {}): string {
  return options.muted ? kitP(html, kitType("sans", 15, 22, 400, KIT.muted, WRAP)) : kitP(html, kitType("sans", 16, 24, 400, KIT.black, WRAP));
}

/** A notice box ("Before you go", "How it works", "What changed", …): 1px black outline, radius 8, padding 24. `linesHtml` are trusted markup. */
export function kitNotice(title: string, linesHtml: ReadonlyArray<string>): string {
  return (
    `<table ${FULL} style="border-collapse:separate;border:1px solid ${KIT.black};border-radius:8px"><tr><td style="padding:24px">` +
    kitStack(
      [
        kitP(escapeHtml(title), kitType("sans", 15, 22, 600, KIT.black, WRAP)),
        ...linesHtml.map((line) => kitP(line, kitType("sans", 14, 20, 400, KIT.muted, WRAP))),
      ],
      8,
    ) +
    `</td></tr></table>`
  );
}

export type KitIcon = "calendar" | "pin" | "info";

export interface KitDetailRow {
  icon: KitIcon;
  /** Plain text. */
  title: string;
  /** Plain text, muted. */
  lines?: ReadonlyArray<string>;
  /** The underlined link under the lines (trusted markup), e.g. calendar links. */
  linkHtml?: string;
}

/** Detail rows (date, venue, event info, host): a 40px grey icon tile, then the title, muted lines and a link; 24px apart. */
export function kitDetails(siteUrl: string, rows: ReadonlyArray<KitDetailRow>): string {
  const row = (r: KitDetailRow) =>
    `<table ${FULL}><tr>` +
    `<td width="40" valign="top" style="width:40px"><table ${TABLE}><tr><td width="40" height="40" align="center" valign="middle" bgcolor="${KIT.surface}" style="width:40px;height:40px;border-radius:20px;background-color:${KIT.surface}">` +
    `<img src="${escapeHtml(ticketAssetUrl(siteUrl, TICKET_EMAIL_ASSETS[r.icon]))}" width="20" height="20" alt="" style="display:block;border:0;width:20px;height:20px;margin:0 auto"></td></tr></table></td>` +
    `<td width="16" style="width:16px;font-size:0;line-height:0">&nbsp;</td>` +
    `<td valign="top">` +
    kitStack(
      [
        kitP(escapeHtml(r.title), kitType("sans", 16, 24, 600, KIT.black, WRAP)),
        ...(r.lines ?? []).map((l) => kitP(escapeHtml(l), kitType("sans", 16, 24, 400, KIT.muted, WRAP))),
        r.linkHtml ? kitP(r.linkHtml, kitType("sans", 15, 22, 600, KIT.black)) : "",
      ],
      4,
    ) +
    `</td></tr></table>`;
  return kitStack(rows.map(row), 24);
}

export interface KitButton {
  label: string;
  href: string;
  /** The orange call to action (with its arrow) or the white outlined one. */
  kind: "primary" | "secondary";
}

function buttonCell(b: KitButton, phoneSize = true): string {
  if (b.kind === "primary") {
    return (
      `<table ${FULL}><tr><td align="center" bgcolor="${KIT.orange}" style="background-color:${KIT.orange};border-radius:8px;mso-padding-alt:16px 24px">` +
      // One line at every width (white-space:nowrap); the arrow takes the label's size, so it shrinks with it on a phone.
      `<a${phoneSize ? ' class="kbp"' : ""} href="${escapeHtml(b.href)}" style="display:block;padding:16px 24px;${kitType("sans", 18, 24, 500, KIT.black, "text-align:center;text-decoration:none;white-space:nowrap")}">${escapeHtml(b.label)}&nbsp;&nbsp;<span style="font-family:Arial,Helvetica,sans-serif;font-weight:700">&rarr;</span></a>` +
      `</td></tr></table>`
    );
  }
  return (
    `<table ${FULL} style="border-collapse:separate"><tr><td align="center" bgcolor="${KIT.white}" style="background-color:${KIT.white};border:1.5px solid ${KIT.black};border-radius:8px;mso-padding-alt:14px 24px">` +
    `<a class="kbs" href="${escapeHtml(b.href)}" style="display:block;padding:14.5px 24px;${kitType("sans", 16, 24, 600, KIT.black, "text-align:center;text-decoration:none;white-space:nowrap")}">${escapeHtml(b.label)}</a>` +
    `</td></tr></table>`
  );
}

/**
 * The actions row: one button the full width, or two equal halves 12px apart
 * (8 on a phone, still side by side). `hug`: one button as wide as its label
 * (the organiser emails), the full width on a phone at its desktop size.
 */
export function kitButtons(buttons: ReadonlyArray<KitButton>, options: { hug?: boolean } = {}): string {
  if (buttons.length === 0) return "";
  if (buttons.length === 1) {
    // The organiser frames keep the 56px button with its 18px label on a phone, full width.
    return options.hug ? `<table ${TABLE} class="kw"><tr><td>${buttonCell(buttons[0], false)}</td></tr></table>` : buttonCell(buttons[0]);
  }
  const [a, b] = buttons;
  return (
    `<table ${FULL}><tr>` +
    `<td class="kl" width="50%" valign="top" style="width:50%;padding-right:6px">${buttonCell(a)}</td>` +
    `<td class="kr" width="50%" valign="top" style="width:50%;padding-left:6px">${buttonCell(b)}</td>` +
    `</tr></table>`
  );
}

export interface KitSummaryRow {
  /** Plain text. */
  label: string;
  /** Plain text. */
  value: string;
  /** The value in IBM Plex Mono (the order reference). */
  mono?: boolean;
}

/** The order / refund summary: hairlines above and below, a bold title, label / value rows, the total, then muted notes (plain text). */
export function kitSummary(input: { title: string; rows: ReadonlyArray<KitSummaryRow>; total: KitSummaryRow; notes?: ReadonlyArray<string> }): string {
  const row = (r: KitSummaryRow, total = false) =>
    `<tr><td valign="top" style="padding:8px 12px 0 0;${kitType("sans", 16, 24, total ? 600 : 400, total ? KIT.black : KIT.muted)}">${escapeHtml(r.label)}</td>` +
    `<td align="right" valign="top" style="padding:8px 0 0 0;${r.mono ? kitType("mono", 16, 24, 500, KIT.black) : kitType("sans", 16, 24, total ? 700 : 400, KIT.black)}">${escapeHtml(r.value)}</td></tr>`;
  return (
    `<table ${FULL}><tr><td style="border-top:1px solid ${KIT.line};border-bottom:1px solid ${KIT.line};padding:24px 0">` +
    `<h2 style="margin:0;${kitType("sans", 20, 28, 700, KIT.black)}">${escapeHtml(input.title)}</h2>` +
    `<table ${FULL}>${input.rows.map((r) => row(r)).join("")}${row(input.total, true)}</table>` +
    (input.notes ?? []).map((n) => kitP(escapeHtml(n), kitType("sans", 14, 20, 400, KIT.muted, "padding-top:8px"))).join("") +
    `</td></tr></table>`
  );
}

/** "Going with friends?": a cream box with share chips (white, 1.5px black outline). */
export function kitTellAFriend(links: ReadonlyArray<{ label: string; href: string }>): string {
  const chip = (l: { label: string; href: string }) =>
    `<a href="${escapeHtml(l.href)}" style="display:inline-block;margin:8px 8px 0 0;padding:8px 16px;border:1.5px solid ${KIT.black};border-radius:8px;background-color:${KIT.white};${kitType("sans", 14, 20, 600, KIT.black, "text-decoration:none;white-space:nowrap")}">${escapeHtml(l.label)}</a>`;
  return (
    `<table ${FULL} bgcolor="${KIT.cream}" style="background-color:${KIT.cream};border-radius:12px;border-collapse:separate"><tr><td style="padding:24px">` +
    `<h2 style="margin:0;${kitType("sans", 18, 24, 700, KIT.black)}">Going with friends?</h2>` +
    kitP("Send them the event so you can go together.", kitType("sans", 15, 22, 400, KIT.muted, "padding-top:8px")) +
    `<div style="padding-top:8px;font-size:0;line-height:0">${links.map(chip).join("")}</div>` +
    `</td></tr></table>`
  );
}

/** "Need a hand? support@…" (customer: 15/22, left) or "Need help? support@…" (organiser: 14/20, centred). */
export function kitHelp(tone: EmailTone): string {
  const address = kitLink(`mailto:${SUPPORT_EMAIL}`, escapeHtml(SUPPORT_EMAIL));
  return tone === "customer"
    ? kitP(`Need a hand? ${address}`, kitType("sans", 15, 22, 400, KIT.black))
    : kitP(`Need help? ${address}`, kitType("sans", 14, 20, 400, KIT.black, "text-align:center"));
}

/** The help line as plain text. */
export function kitHelpText(tone: EmailTone): string {
  return `${tone === "customer" ? "Need a hand?" : "Need help?"} ${SUPPORT_EMAIL}`;
}

export const KIT_TAGLINE = "Find your place, find your people.";

export interface KitFooterInput {
  siteUrl: string;
  tone: EmailTone;
  /** Why the reader got this email (plain text); no line when absent. */
  reason?: string;
  /** An optional link after the reason, e.g. "Stop these emails", and plain text after it. */
  reasonLink?: { label: string; href: string; after?: string };
}

function footerLinks(siteUrl: string) {
  const site = siteUrl.replace(/\/+$/, "");
  return [
    { label: "Privacy policy", href: `${site}/privacy` },
    { label: "Terms", href: `${site}/terms` },
    { label: "Help centre", href: `${site}/help` },
  ];
}

/**
 * The footer: a hairline, the orange wordmark, the tagline, "SHELTÜH ·
 * MELBOURNE", Privacy policy · Terms · Help centre, and why the reader got
 * this email. Centred; every line wraps. (The frames' company line is left
 * out until the owner confirms the company details.)
 */
export function kitFooter({ siteUrl, tone, reason, reasonLink }: KitFooterInput): string {
  const small = kitType("sans", 12, 16, 400, KIT.muted, WRAP);
  const linkLine = footerLinks(siteUrl)
    .map((l) => kitLink(l.href, escapeHtml(l.label), KIT.muted))
    .join(" &nbsp;&middot;&nbsp; ");
  const city =
    tone === "customer" ? kitType("mono", 12, 16, 500, KIT.muted, "letter-spacing:0.72px") : kitType("mono", 12, 16, 400, KIT.muted);
  return (
    `<table ${FULL}><tr><td align="center" style="border-top:1px solid ${KIT.line};padding:24px 0 0 0">` +
    `<table ${TABLE} align="center"><tr><td>${wordmarkTag(88, 20)}</td></tr></table>` +
    kitP(KIT_TAGLINE, kitType("sans", 14, 20, 400, KIT.muted, "text-align:center;padding-top:8px")) +
    kitP("SHELT&Uuml;H &middot; MELBOURNE", `${city};text-align:center;padding-top:8px`) +
    kitP(linkLine, `${small};text-align:center;padding-top:8px`) +
    (reason
      ? kitP(
          escapeHtml(reason) +
            (reasonLink ? ` ${kitLink(reasonLink.href, escapeHtml(reasonLink.label), KIT.muted)}${escapeHtml(reasonLink.after ?? "")}` : ""),
          `${small};text-align:center;padding-top:8px`,
        )
      : "") +
    `</td></tr></table>`
  );
}

/** The footer as plain text. */
export function kitFooterText({ siteUrl, reason, reasonLink }: KitFooterInput): string {
  return [
    KIT_TAGLINE,
    "Sheltüh · Melbourne",
    footerLinks(siteUrl)
      .map((l) => `${l.label}: ${l.href}`)
      .join(" · "),
    ...(reason ? [reason] : []),
    ...(reasonLink ? [`${reasonLink.label}${(reasonLink.after ?? "").replace(/\.$/, "")}: ${reasonLink.href}`] : []),
  ].join("\n");
}

// --- The compact Ticket card (the reminder; the accept and transfer emails) ---

export interface KitTicketCardInput {
  /** "Sat 14 Nov · 5–9 pm" (plain text). */
  dateLine: string;
  title: string;
  venue: string;
  /** The event image's absolute https URL, or null (no image cell). */
  imageUrl: string | null;
  /** The title as a link (the event's page), e.g. in the follower email. */
  href?: string;
  /** An optional holder row: "Sam Lee · Second release" and "1 of 1". */
  holder?: { name: string; count: string };
}

/** The 1120 Ticket card, Active, without its status bar or button: white, 1px border/subtle, radius 16, padding 16; an 88px image, then date, title, venue. */
export function kitTicketCard(card: KitTicketCardInput): string {
  const image = card.imageUrl
    ? `<td width="88" valign="middle" style="width:88px"><img src="${escapeHtml(card.imageUrl)}" width="88" height="88" alt="${escapeHtml(card.title)}" style="display:block;border:0;width:88px;height:88px;object-fit:cover;border-radius:8px;${kitType("sans", 12, 16, 400, KIT.muted)}"></td><td width="16" style="width:16px;font-size:0;line-height:0">&nbsp;</td>`
    : "";
  const text = kitStack(
    [
      card.dateLine ? kitP(escapeHtml(card.dateLine), kitType("mono", 12, 16, 400, KIT.black)) : "",
      kitP(card.href ? kitLink(card.href, escapeHtml(card.title), KIT.black, "text-decoration:none") : escapeHtml(card.title), kitType("sans", 20, 28, 600, KIT.black, WRAP)),
      card.venue ? kitP(escapeHtml(card.venue), kitType("sans", 14, 20, 400, KIT.black, WRAP)) : "",
    ],
    4,
  );
  const holder = card.holder
    ? `<tr><td style="padding:16px 0 0 0"><table ${FULL}><tr><td valign="top" style="${kitType("sans", 14, 20, 600, KIT.black, WRAP)}">${escapeHtml(card.holder.name)}</td><td align="right" valign="top" style="padding-left:12px;white-space:nowrap;${kitType("mono", 12, 16, 400, KIT.black)}">${escapeHtml(card.holder.count)}</td></tr></table></td></tr>`
    : "";
  return (
    `<table ${FULL} bgcolor="${KIT.white}" style="background-color:${KIT.white};border:1px solid ${KIT.line};border-radius:16px;border-collapse:separate"><tr><td style="padding:16px">` +
    `<table ${FULL}><tr><td><table ${FULL}><tr>${image}<td valign="middle">${text}</td></tr></table></td></tr>${holder}</table>` +
    `</td></tr></table>`
  );
}

// --- Organiser pieces ---

/**
 * The organiser hero: a black panel, radius 16, an orange mono eyebrow and a
 * two-line heading (white, then orange). With `photo` (an https URL, 2:1),
 * the photo sits on top; without, the panel is 40 / 24 padded.
 */
export function kitHero(input: { eyebrow: string; line1: string; line2: string; photo?: { src: string; alt: string } }): string {
  const text =
    kitP(escapeHtml(input.eyebrow), kitType("mono", 12, 16, 400, KIT.orange)) +
    `<h1 style="margin:0;padding-top:12px;${kitType("sans", 24, 32, 600, KIT.white, WRAP)}">${escapeHtml(input.line1)}<br><span style="color:${KIT.orange}">${escapeHtml(input.line2)}</span></h1>`;
  const photo =
    input.photo && /^https:\/\//i.test(input.photo.src)
      ? `<tr><td style="padding:16px 16px 0 16px"><img src="${escapeHtml(input.photo.src)}" width="504" alt="${escapeHtml(input.photo.alt)}" style="display:block;border:0;width:100%;max-width:504px;height:auto;border-radius:16px"></td></tr>`
      : "";
  return (
    `<table ${FULL} bgcolor="${KIT.black}" style="background-color:${KIT.black};border-radius:16px;border-collapse:separate">` +
    photo +
    `<tr><td style="padding:${photo ? "24px 24px 32px 24px" : "40px 24px"}">${text}</td></tr>` +
    `</table>`
  );
}

/** The organiser body: the greeting (SemiBold) and paragraphs, 16/24, 16px apart. Plain text. */
export function kitBody(greeting: string, paragraphs: ReadonlyArray<string>): string {
  return kitStack(
    [
      greeting ? kitP(escapeHtml(greeting), kitType("sans", 16, 24, 600, KIT.black, WRAP)) : "",
      ...paragraphs.map((p) => kitP(escapeHtml(p), kitType("sans", 16, 24, 400, KIT.black, WRAP))),
    ],
    16,
  );
}

export interface KitStep {
  title: string;
  description: string;
  link?: { label: string; href: string };
}

const stepNumber = (i: number) => String(i + 1).padStart(2, "0");

/** Numbered steps: a mono eyebrow, an optional heading, then cream cards each with a black 48px number badge. */
export function kitSteps(input: { eyebrow?: string; heading?: string; steps: ReadonlyArray<KitStep> }): string {
  const card = (s: KitStep, i: number) =>
    `<table ${FULL} bgcolor="${KIT.cream}" style="background-color:${KIT.cream};border-radius:16px;border-collapse:separate"><tr><td style="padding:24px"><table ${FULL}><tr>` +
    `<td width="48" valign="top" style="width:48px"><table ${TABLE}><tr><td width="48" height="48" align="center" valign="middle" bgcolor="${KIT.black}" style="width:48px;height:48px;border-radius:8px;background-color:${KIT.black};${kitType("mono", 14, 20, 500, KIT.white)}">${stepNumber(i)}</td></tr></table></td>` +
    `<td width="16" style="width:16px;font-size:0;line-height:0">&nbsp;</td>` +
    `<td valign="top">` +
    kitStack(
      [
        kitP(escapeHtml(s.title), kitType("sans", 16, 24, 600, KIT.black, WRAP)),
        kitP(escapeHtml(s.description), kitType("sans", 14, 20, 400, KIT.muted, WRAP)),
        s.link ? kitP(kitLink(s.link.href, escapeHtml(s.link.label), KIT.muted), kitType("sans", 14, 20, 600, KIT.muted)) : "",
      ],
      4,
    ) +
    `</td></tr></table></td></tr></table>`;
  return kitStack(
    [
      input.eyebrow ? kitP(escapeHtml(input.eyebrow), kitType("mono", 12, 16, 400, KIT.muted)) : "",
      input.heading ? kitP(escapeHtml(input.heading), kitType("sans", 20, 28, 600, KIT.black, WRAP)) : "",
      ...input.steps.map(card),
    ],
    12,
  );
}

/** The steps as plain text: "01 Title", the description, the link. */
export function kitStepsText(input: { eyebrow?: string; heading?: string; steps: ReadonlyArray<KitStep> }): string {
  return [
    ...(input.eyebrow ? [input.eyebrow.toUpperCase()] : []),
    ...(input.heading ? [input.heading] : []),
    "",
    input.steps
      .map((s, i) => [`${stepNumber(i)} ${s.title}`, `   ${s.description}`, ...(s.link ? [`   ${s.link.label}: ${s.link.href}`] : [])].join("\n"))
      .join("\n\n"),
  ].join("\n");
}

/** Stat tiles, two by two, 12px apart: cream, radius 16, the number (24/32) over its label. Plain text. */
export function kitStats(tiles: ReadonlyArray<{ value: string; label: string }>): string {
  const tile = (t: { value: string; label: string }) =>
    `<table ${FULL} bgcolor="${KIT.cream}" style="background-color:${KIT.cream};border-radius:16px;border-collapse:separate"><tr><td style="padding:20px">` +
    kitP(escapeHtml(t.value), kitType("sans", 24, 32, 600, KIT.black)) +
    kitP(escapeHtml(t.label), kitType("sans", 14, 20, 400, KIT.muted, "padding-top:4px")) +
    `</td></tr></table>`;
  const rows: string[] = [];
  for (let i = 0; i < tiles.length; i += 2) {
    const pair = tiles.slice(i, i + 2);
    rows.push(
      `<table ${FULL}><tr>` +
        `<td width="50%" valign="top" style="width:50%;padding-right:6px">${tile(pair[0])}</td>` +
        `<td width="50%" valign="top" style="width:50%;padding-left:6px">${pair[1] ? tile(pair[1]) : ""}</td>` +
        `</tr></table>`,
    );
  }
  return kitStack(rows, 12);
}

/** The sign-off: line 1 regular, line 2 SemiBold. Plain text. */
export function kitSignOff(line1: string, line2: string): string {
  return (
    kitP(escapeHtml(line1), kitType("sans", 16, 24, 400, KIT.black, "padding-top:4px")) +
    kitP(escapeHtml(line2), kitType("sans", 16, 24, 600, KIT.black, "padding-top:4px"))
  );
}

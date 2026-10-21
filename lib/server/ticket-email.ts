import { SUPPORT_EMAIL } from "@/lib/contact";
import { formatAud } from "@/lib/format";
import { QR_QUIET_ZONE_MODULES, ticketQrLabel, ticketQrMatrix } from "@/lib/ticket-qr";
import type { EmailMessage, InlineImage } from "./email";
import { orderReference } from "./order-reference";
import { encodePng } from "./png";
import type { EventRecord, OrderRecord } from "./types";

/**
 * Brand footer banner. A fixed public URL on the marketing site, not built
 * from the app's origin, so it renders the same from every environment. It
 * carries no order data, so a hosted image (unlike the QR codes) is fine.
 */
export const EMAIL_FOOTER_IMAGE_URL = "https://sheltuh.com.au/images/email-footer.png";

/**
 * The buyer's tickets email, sent once an order is paid (free orders included).
 *
 * Table-based markup with inline styles so it holds up in Gmail, Apple Mail and
 * Outlook. Everything essential (event, when, where, every ticket code, the
 * total) is real text, so it reads the same with images blocked.
 *
 * Images: the logo mark (remote, decorative) and, for each ticket whose code
 * is a real one (`TICKET_CODE_PATTERN`), its QR code (lib/ticket-qr.ts) as an
 * inline PNG attachment (`cid:`), so it shows even where remote images are
 * blocked. The code stays printed beneath it for the door to type in. The
 * PNGs are made here, each time the email is built: the outbox rebuilds the
 * whole message from the order on every attempt (lib/server/email-outbox.ts),
 * so nothing is stored. No event artwork, no barcode.
 */

// Palette. The blue is the electric blue used across the site's poster art.
const CREAM = "#f3f0e8";
const CARD = "#ffffff";
const INK = "#0b0b0b";
const MUTED = "#5b574e";
const LINE = "#e3ded1";
const BLUE = "#2b3cff";

const SANS = `'Helvetica Neue', Helvetica, Arial, sans-serif`;
const MONO = `'SFMono-Regular', Menlo, Consolas, 'Courier New', monospace`;

const MELBOURNE_TZ = "Australia/Melbourne";

/**
 * QR size: 21 modules plus a 4-module quiet zone each side = 29 modules,
 * shown 6 px a module (174 px). The PNG has 12 px a module, so it stays sharp
 * on high-density screens, and halving it lands on whole pixels everywhere else.
 */
const QR_DISPLAY_PX_PER_MODULE = 6;
const QR_PNG_PX_PER_MODULE = 12;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// --- Dates and times (all Melbourne local time, the platform's timezone) ---

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: MELBOURNE_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const longDate = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, weekday: "long", day: "numeric", month: "long" });
const longDateYear = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortWeekday = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, weekday: "short" });
const clock = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, hour: "numeric", minute: "2-digit", hour12: true });
const zoneName = new Intl.DateTimeFormat("en-AU", { timeZone: MELBOURNE_TZ, timeZoneName: "short" });

function time(iso: string): string {
  return clock.format(new Date(iso)).toLowerCase();
}

function zone(iso: string): string {
  return zoneName.formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "Melbourne time";
}

/**
 * The Melbourne calendar day an event's end belongs to. An end at exactly
 * 12:00 am closes the previous day ("8:00 pm – 12:00 am" on one date).
 */
function endDayKey(endIso: string): string {
  const end = new Date(endIso);
  const justBefore = new Date(end.getTime() - 60_000);
  return clock.format(end) === "12:00 am" ? dayKey.format(justBefore) : dayKey.format(end);
}

/** "Saturday 6 March 2027", or for several days "Friday 5 March – Saturday 6 March 2027". */
export function formatTicketDate(startIso: string, endIso?: string): string {
  const start = new Date(startIso);
  if (!endIso || dayKey.format(start) >= endDayKey(endIso)) return longDateYear.format(start);
  const end = new Date(new Date(endIso).getTime() - (clock.format(new Date(endIso)) === "12:00 am" ? 60_000 : 0));
  const sameYear = dayKey.format(start).slice(0, 4) === dayKey.format(end).slice(0, 4);
  return `${sameYear ? longDate.format(start) : longDateYear.format(start)} – ${longDateYear.format(end)}`;
}

/**
 * "8:00 pm – 11:00 pm AEDT" for a same-day event. An event that crosses
 * midnight (judged in Melbourne time, not UTC) names the days:
 * "9:00 pm (Fri) – 2:00 am (Sat) AEDT".
 */
export function formatTicketTime(startIso: string, endIso?: string): string {
  const start = new Date(startIso);
  const tz = zone(startIso);
  if (!endIso) return `${time(startIso)} ${tz}`;
  const end = new Date(endIso);
  if (dayKey.format(start) >= endDayKey(endIso)) return `${time(startIso)} – ${time(endIso)} ${tz}`;
  return `${time(startIso)} (${shortWeekday.format(start)}) – ${time(endIso)} (${shortWeekday.format(end)}) ${zone(endIso) === tz ? tz : `${tz} / ${zone(endIso)}`}`;
}

export { orderReference };

// --- HTML pieces ---

function detailRow(label: string, value: string): string {
  return (
    `<tr><td valign="top" width="96" style="padding:10px 12px 10px 0;font-family:${SANS};font-size:12px;line-height:20px;letter-spacing:1.2px;text-transform:uppercase;font-weight:bold;color:${MUTED}">${escapeHtml(label)}</td>` +
    `<td valign="top" style="padding:10px 0;font-family:${SANS};font-size:16px;line-height:24px;color:${INK}">${escapeHtml(value)}</td></tr>`
  );
}

interface TicketQr {
  image: InlineImage;
  /** Shown width and height, in CSS pixels. */
  px: number;
  alt: string;
}

/** The ticket's QR as an inline PNG, or null when the code isn't a real one. */
function ticketQr(code: string, index: number): TicketQr | null {
  const matrix = ticketQrMatrix(code);
  if (!matrix) return null;
  return {
    image: {
      cid: `ticket-qr-${index + 1}@sheltuh.com.au`,
      contentType: "image/png",
      content: encodePng(matrix, QR_PNG_PX_PER_MODULE, QR_QUIET_ZONE_MODULES),
      // Not the code: attachment names show up in mail previews, file lists and downloads, and the code is the ticket.
      filename: `ticket-${index + 1}-qr.png`,
    },
    px: (matrix.length + QR_QUIET_ZONE_MODULES * 2) * QR_DISPLAY_PX_PER_MODULE,
    alt: ticketQrLabel(code),
  };
}

function ticketCard(code: string, typeName: string, index: number, total: number, qr: TicketQr | null): string {
  const label = total > 1 ? `Ticket ${index + 1} of ${total}` : "Your ticket";
  // The PNG carries its own white quiet zone, so the card behind it needn't be white.
  const qrRow = qr
    ? `<tr><td align="center" style="padding:4px 18px 10px 18px"><img src="cid:${escapeHtml(qr.image.cid)}" width="${qr.px}" height="${qr.px}" alt="${escapeHtml(qr.alt)}" style="display:block;border:0;width:${qr.px}px;height:${qr.px}px;image-rendering:pixelated;-ms-interpolation-mode:nearest-neighbor"></td></tr>\n`
    : "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${INK};border-radius:10px;margin:0 0 14px 0">
<tr><td style="padding:16px 18px 6px 18px;font-family:${SANS};font-size:12px;line-height:18px;letter-spacing:1.2px;text-transform:uppercase;font-weight:bold;color:${MUTED}">${escapeHtml(label)}${typeName ? ` &middot; ${escapeHtml(typeName)}` : ""}</td></tr>
${qrRow}<tr><td style="padding:0 18px 16px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td class="code" bgcolor="${CREAM}" align="center" style="background-color:${CREAM};border-radius:8px;padding:14px 8px;font-family:${MONO};font-size:28px;line-height:34px;font-weight:bold;letter-spacing:3px;color:${INK};word-break:break-all">${escapeHtml(code)}</td></tr></table></td></tr>
</table>`;
}

/** The sent email: a 600px-wide card, with a plain-text alternative. */
export function buildTicketEmail(order: OrderRecord, event: EventRecord, siteUrl: string): EmailMessage {
  const link = `${siteUrl}/checkout/success?session_id=${encodeURIComponent(order.orderId)}`;
  // /checkout/success lists every ticket code, so the button can say "tickets".
  const buttonLabel = order.tickets.length === 1 ? "View your ticket" : "View your tickets";
  const date = formatTicketDate(event.startsAt, event.endsAt);
  const when = formatTicketTime(event.startsAt, event.endsAt);
  const venue = event.venueName?.trim() ?? "";
  const address = event.venueAddress?.trim() ?? "";
  const reference = orderReference(order.orderId);
  const total = order.totalCents === 0 ? "Free" : `${formatAud(order.totalCents)} (incl. booking fees)`;
  const logoUrl = `${siteUrl}/icons/icon-192.png`;
  const qrs = order.tickets.map((t, i) => ticketQr(t.ticketCode, i));
  const anyQr = qrs.some((qr) => qr !== null);
  const one = order.tickets.length === 1;

  // --- Plain text ---
  const text = [
    "YOU'RE IN.",
    event.title,
    "",
    `Date: ${date}`,
    `Time: ${when}`,
    ...(venue ? [`Venue: ${venue}`] : []),
    ...(address ? [`Address: ${address}`] : []),
    "",
    ...(anyQr
      ? [
          one ? "YOUR TICKET" : "YOUR TICKETS",
          // A text-only reader can't see the QR here: point them at the code, and at the full email for the QR.
          one
            ? "Show your entry code at the door (the QR code is in the full email)."
            : "Show your entry codes at the door (the QR codes are in the full email).",
        ]
      : ["YOUR TICKETS (show these codes at the door)"]),
    ...order.tickets.flatMap((t, i) => [
      "",
      `${order.tickets.length > 1 ? `Ticket ${i + 1} of ${order.tickets.length}` : "Your ticket"}${t.ticketTypeName ? ` - ${t.ticketTypeName}` : ""}`,
      `Entry code: ${t.ticketCode}`,
    ]),
    "",
    `${buttonLabel}: ${link}`,
    "",
    `Order reference: ${reference}`,
    `Total paid: ${total}`,
    "",
    `Need help? Email ${SUPPORT_EMAIL}`,
    "Sheltüh, Melbourne",
  ].join("\n");

  // --- HTML ---
  const details =
    detailRow("Date", date) + detailRow("Time", when) + (venue ? detailRow("Venue", venue) : "") + (address ? detailRow("Address", address) : "");
  const tickets = order.tickets.map((t, i) => ticketCard(t.ticketCode, t.ticketTypeName, i, order.tickets.length, qrs[i])).join("\n");
  const preheader = `Your ${one ? "ticket" : "tickets"} for ${event.title}. Show your ${anyQr ? "QR code" : "entry code"} at the door.`;
  const instructions = anyQr
    ? `Show ${one ? "this QR code" : "these QR codes"} at the door. Turn your screen brightness up. If ${one ? "it" : "one"} won&rsquo;t scan, door staff can type in ${one ? "the" : "its"} code.`
    : `Show ${one ? "this code" : "these codes"} at the door.`;

  const html = `<!DOCTYPE html>
<html lang="en-AU" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(`You're in: ${event.title}`)}</title>
<style>
  @media only screen and (max-width: 620px) {
    .px { padding-left: 18px !important; padding-right: 18px !important; }
    .h1 { font-size: 34px !important; line-height: 38px !important; }
    .code { font-size: 24px !important; letter-spacing: 2px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${CREAM};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${CREAM};font-size:1px;line-height:1px">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${CREAM}" style="background-color:${CREAM}">
<tr><td align="center" style="padding:24px 12px">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px">
  <tr><td align="left" style="padding:0 4px 16px 4px">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="middle" style="padding-right:10px"><img src="${escapeHtml(logoUrl)}" width="40" height="40" alt="" style="display:block;border:0;border-radius:9px"></td>
      <td valign="middle" style="font-family:${SANS};font-size:26px;line-height:30px;font-weight:bold;letter-spacing:-0.5px;color:${INK}">Sheltüh</td>
    </tr></table>
  </td></tr>
  <tr><td bgcolor="${CARD}" class="px" style="background-color:${CARD};border:1px solid ${LINE};border-radius:14px;padding:32px 30px">
    <h1 class="h1" style="margin:0 0 8px 0;font-family:${SANS};font-size:42px;line-height:46px;font-weight:bold;letter-spacing:-1px;color:${INK}">You&rsquo;re in.</h1>
    <p style="margin:0 0 24px 0;font-family:${SANS};font-size:22px;line-height:28px;font-weight:bold;color:${BLUE}">${escapeHtml(event.title)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};margin:0 0 28px 0">${details}</table>
    <p style="margin:0 0 6px 0;font-family:${SANS};font-size:18px;line-height:26px;font-weight:bold;color:${INK}">Your ${order.tickets.length === 1 ? "ticket" : "tickets"}</p>
    <p style="margin:0 0 16px 0;font-family:${SANS};font-size:16px;line-height:24px;color:${INK}">${instructions}</p>
${tickets}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 28px 0"><tr>
      <td bgcolor="${BLUE}" align="center" style="background-color:${BLUE};border-radius:10px"><a href="${escapeHtml(link)}" style="display:block;padding:14px 30px;min-height:20px;font-family:${SANS};font-size:16px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(buttonLabel)}</a></td>
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE}">
      <tr><td style="padding:14px 12px 4px 0;font-family:${SANS};font-size:14px;line-height:20px;color:${MUTED};white-space:nowrap">Order reference</td><td align="right" style="padding:14px 0 4px 0;font-family:${MONO};font-size:14px;line-height:20px;color:${INK}">${escapeHtml(reference)}</td></tr>
      <tr><td valign="top" style="padding:4px 12px 0 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:bold;color:${INK};white-space:nowrap">Total paid</td><td align="right" valign="top" style="padding:4px 0 0 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:bold;color:${INK}">${escapeHtml(order.totalCents === 0 ? "Free" : formatAud(order.totalCents))}${order.totalCents === 0 ? "" : `<br><span style="font-size:13px;line-height:18px;font-weight:normal;color:${MUTED}">incl. booking fees</span>`}</td></tr>
    </table>
  </td></tr>
  <tr><td align="center" style="padding:20px 12px 0 12px;font-family:${SANS};font-size:13px;line-height:20px;color:${MUTED}">
    Need help? Email <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${MUTED};text-decoration:underline">${escapeHtml(SUPPORT_EMAIL)}</a><br>
    Sheltüh &middot; Melbourne
  </td></tr>
  <tr><td style="padding:20px 0 0 0"><img src="${EMAIL_FOOTER_IMAGE_URL}" width="600" alt="Sheltüh. Music. Art. Fashion. Culture." style="display:block;border:0;width:100%;max-width:600px;height:auto"></td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;

  const inlineImages = qrs.flatMap((qr) => (qr ? [qr.image] : []));
  return {
    to: order.buyerEmail ?? "",
    subject: `Your tickets: ${event.title}`,
    text,
    html,
    ...(inlineImages.length > 0 ? { inlineImages } : {}),
  };
}

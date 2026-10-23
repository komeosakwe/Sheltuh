import { SUPPORT_EMAIL } from "@/lib/contact";
import { formatAud } from "@/lib/format";
import { formatSeatLine, speakSeatLine } from "@/lib/seating/format";
import { QR_QUIET_ZONE_MODULES, ticketQrLabel, ticketQrMatrix } from "@/lib/ticket-qr";
import { subjectLine, type EmailMessage, type InlineImage } from "./email";
import { button, escapeHtml, eventTitle, heading, INK, LINE, MONO, MUTED, page, SANS, SURFACE } from "./email-layout";
import { EMAIL_WORDMARK } from "./email-wordmark";
import { orderReference } from "./order-reference";
import { encodePng } from "./png";
import type { EventRecord, OrderRecord, TicketSeat } from "./types";

/**
 * Brand footer banner (public/images/email-footer.png, 1200 x 400, shown at up
 * to 600 px wide). A fixed public URL on the marketing site, not built from
 * the app's origin, so it renders the same from every environment. It's the
 * same for everyone and carries no order data, so a hosted image (unlike the
 * QR codes) is fine, and it's decorative: a client blocking remote images
 * loses nothing (its alt text says what it is).
 */
export const EMAIL_FOOTER_IMAGE_URL = "https://sheltuh.com.au/images/email-footer.png";

/**
 * The buyer's tickets email, sent once an order is paid (free orders included).
 *
 * The shared brand layout (lib/server/email-layout.ts: table markup, inline
 * styles, white page, one white card, Signal Orange only on the button, a
 * button that keeps its size in Outlook, a preheader hidden there too) so it
 * holds up in Gmail, Apple Mail and Outlook and matches every other email.
 * Everything essential (event, when, where, every ticket code and seat, the
 * total) is real text, so it reads the same with images blocked; every image
 * has alt text.
 *
 * An event that's no longer published (unpublished, back in draft or review,
 * or rejected) gets EVENT_UNLISTED_TEXT instead of its date, time, venue and
 * address: the same rule as the ticket page (toCustomerOrder in
 * lib/server/records.ts) and the public event routes (`status = 'published'`).
 * The outbox rebuilds the email from the live event on every attempt and
 * resend, so a resent email follows the rule as it stands then.
 *
 * Images: the official uppercase wordmark above the card
 * (lib/server/email-wordmark.ts, rendered from public/brand/sheltuh-wordmark.svg
 * by scripts/render-email-wordmark.ts, about 4 KB) and, for each ticket whose
 * code is a real one (`TICKET_CODE_PATTERN`), its QR code (lib/ticket-qr.ts),
 * both as inline PNG attachments (`cid:`), so they show even where remote
 * images are blocked (Outlook's default); with every image off, the
 * wordmark's alt text "SHELTÜH" names the brand. The code stays printed
 * beneath its QR, as the backup code, for the door to type in. The QR PNGs are
 * made here, each time the email is built: the outbox rebuilds the whole
 * message from the order on every attempt (lib/server/email-outbox.ts), so
 * nothing is stored. The only remote image is the decorative footer banner.
 * No event artwork, no barcode.
 */

const MELBOURNE_TZ = "Australia/Melbourne";

/**
 * QR size: 21 modules plus a 4-module quiet zone each side = 29 modules,
 * shown 6 px a module (174 px). The PNG has 12 px a module, so it stays sharp
 * on high-density screens, and halving it lands on whole pixels everywhere else.
 */
const QR_DISPLAY_PX_PER_MODULE = 6;
const QR_PNG_PX_PER_MODULE = 12;

/** The wordmark's inline attachment. Its name is the brand's, never anything about the order. */
const WORDMARK_CID = "sheltuh-wordmark@sheltuh.com.au";

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

/**
 * A QR's alt text: what it is, and what to do when it doesn't show (images
 * blocked or not loaded): the backup code printed beneath it.
 */
export function ticketQrAlt(code: string): string {
  return `${ticketQrLabel(code)}. If it doesn't show, use the backup code below.`;
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
    alt: ticketQrAlt(code),
  };
}

function wordmarkImage(): InlineImage {
  return {
    cid: WORDMARK_CID,
    contentType: "image/png",
    content: Buffer.from(EMAIL_WORDMARK.pngBase64, "base64"),
    filename: "sheltuh.png",
  };
}

/**
 * One ticket, like the web stub: its number and type, its seat (reserved
 * seating), a dashed perforation, the QR, then the backup code as large text
 * on the sunken surface tile ("Entry code" when there's no QR). The PNG carries its own white
 * quiet zone.
 */
function ticketCard(
  code: string,
  typeName: string,
  index: number,
  total: number,
  qr: TicketQr | null,
  seat?: TicketSeat,
): string {
  const label = total > 1 ? `Ticket ${index + 1} of ${total}` : "Your ticket";
  const qrRow = qr
    ? `<tr><td align="center" style="padding:16px 18px 10px 18px"><img src="cid:${escapeHtml(qr.image.cid)}" width="${qr.px}" height="${qr.px}" alt="${escapeHtml(qr.alt)}" style="display:block;border:0;width:${qr.px}px;height:${qr.px}px;image-rendering:pixelated;-ms-interpolation-mode:nearest-neighbor;font-family:${SANS};font-size:13px;line-height:18px;color:${INK}"></td></tr>\n`
    : "";
  const codeLabel = qr ? "Backup code" : "Entry code";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:2px solid ${INK};border-radius:10px;margin:0 0 14px 0">
<tr><td style="padding:16px 18px ${seat ? 4 : 12}px 18px;font-family:${SANS};font-size:12px;line-height:18px;letter-spacing:1.2px;text-transform:uppercase;font-weight:bold;color:${MUTED}">${escapeHtml(label)}${typeName ? ` &middot; ${escapeHtml(typeName)}` : ""}</td></tr>
${seat ? `<tr><td style="padding:0 18px 12px 18px;font-family:${SANS};font-size:16px;line-height:24px;font-weight:bold;color:${INK}">${escapeHtml(formatSeatLine(seat))}</td></tr>\n` : ""}<tr><td style="border-top:2px dashed ${INK};font-size:0;line-height:0">&nbsp;</td></tr>
${qrRow}<tr><td style="padding:${qr ? "0" : "16px"} 18px 16px 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="padding:0 0 6px 0;font-family:${SANS};font-size:11px;line-height:16px;letter-spacing:1.2px;text-transform:uppercase;font-weight:bold;color:${MUTED}">${codeLabel}</td></tr><tr><td class="code" bgcolor="${SURFACE}" align="center" style="background-color:${SURFACE};border-radius:8px;padding:14px 8px;font-family:${MONO};font-size:28px;line-height:34px;font-weight:bold;letter-spacing:3px;color:${INK};word-break:break-all">${escapeHtml(code)}</td></tr></table></td></tr>
</table>`;
}

/** The order's ticket page: /checkout/success for this order (the order id is its credential). */
export function ticketPageLink(siteUrl: string, orderId: string): string {
  return `${siteUrl}/checkout/success?session_id=${encodeURIComponent(orderId)}`;
}

/**
 * What the email says, in place of the date, time, venue and address, when
 * the event isn't published any more (unpublished, back in draft or review,
 * or rejected): its details are no longer public, and may no longer be right.
 * The tickets still go out. The same rule as the ticket page (toCustomerOrder).
 */
export const EVENT_UNLISTED_TEXT = `This event is no longer listed. Contact ${SUPPORT_EMAIL} if you have questions.`;

/** The sent email: a 600px-wide card, with a plain-text alternative. */
export function buildTicketEmail(order: OrderRecord, event: EventRecord, siteUrl: string): EmailMessage {
  const link = ticketPageLink(siteUrl, order.orderId);
  // /checkout/success lists every ticket code, so the button can say "tickets".
  const buttonLabel = order.tickets.length === 1 ? "View your ticket" : "View your tickets";
  // Only a published event's details go out (the outbox passes the live event on every attempt and resend).
  const listed = event.status === "published";
  const date = listed ? formatTicketDate(event.startsAt, event.endsAt) : "";
  const when = listed ? formatTicketTime(event.startsAt, event.endsAt) : "";
  const venue = listed ? (event.venueName?.trim() ?? "") : "";
  const address = listed ? (event.venueAddress?.trim() ?? "") : "";
  const reference = orderReference(order.orderId);
  const total = order.totalCents === 0 ? "Free" : `${formatAud(order.totalCents)} (incl. booking fees)`;
  const qrs = order.tickets.map((t, i) => ticketQr(t.ticketCode, i));
  const anyQr = qrs.some((qr) => qr !== null);
  const one = order.tickets.length === 1;

  // --- Plain text ---
  const text = [
    "SHELTÜH",
    "",
    "YOU'RE IN.",
    event.title,
    "",
    ...(listed
      ? [
          `Date: ${date}`,
          `Time: ${when}`,
          ...(venue ? [`Venue: ${venue}`] : []),
          ...(address ? [`Address: ${address}`] : []),
        ]
      : [EVENT_UNLISTED_TEXT]),
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
      ...(t.seat ? [`Seat: ${speakSeatLine(t.seat)}`] : []),
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
  const details = listed
    ? detailRow("Date", date) + detailRow("Time", when) + (venue ? detailRow("Venue", venue) : "") + (address ? detailRow("Address", address) : "")
    : `<tr><td style="padding:10px 0;font-family:${SANS};font-size:16px;line-height:24px;color:${INK}">This event is no longer listed. Contact <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${INK};text-decoration:underline">${escapeHtml(SUPPORT_EMAIL)}</a> if you have questions.</td></tr>`;
  const tickets = order.tickets.map((t, i) => ticketCard(t.ticketCode, t.ticketTypeName, i, order.tickets.length, qrs[i], t.seat)).join("\n");
  const preheader = `Your ${one ? "ticket" : "tickets"} for ${event.title}. Show your ${anyQr ? "QR code" : "entry code"} at the door.`;
  const instructions = anyQr
    ? `Show ${one ? "this QR code" : "these QR codes"} at the door. Turn your screen brightness up. If ${one ? "it" : "one"} won&rsquo;t scan, door staff can type in ${one ? "the" : "its"} backup code.`
    : `Show ${one ? "this code" : "these codes"} at the door.`;

  // The official wordmark (black on opaque white, docs/design/theme-white-dark.md §5.12), inline so it
  // shows where remote images are blocked; with all images off, its alt text names the brand.
  const header = `<img src="cid:${WORDMARK_CID}" width="${EMAIL_WORDMARK.displayWidth}" height="${EMAIL_WORDMARK.displayHeight}" alt="SHELT&Uuml;H" style="display:block;border:0;width:${EMAIL_WORDMARK.displayWidth}px;height:${EMAIL_WORDMARK.displayHeight}px;font-family:${SANS};font-size:20px;line-height:24px;font-weight:bold;color:${INK}">`;
  const body = `    ${heading("You&rsquo;re in.", 8)}
    ${eventTitle(event.title, 24)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};margin:0 0 28px 0">${details}</table>
    <p style="margin:0 0 6px 0;font-family:${SANS};font-size:18px;line-height:26px;font-weight:bold;color:${INK}">Your ${one ? "ticket" : "tickets"}</p>
    <p style="margin:0 0 16px 0;font-family:${SANS};font-size:16px;line-height:24px;color:${INK}">${instructions}</p>
${tickets}
    ${button(buttonLabel, link, "14px 0 28px 0")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE}">
      <tr><td style="padding:14px 12px 4px 0;font-family:${SANS};font-size:14px;line-height:20px;color:${MUTED};white-space:nowrap">Order reference</td><td align="right" style="padding:14px 0 4px 0;font-family:${MONO};font-size:14px;line-height:20px;color:${INK}">${escapeHtml(reference)}</td></tr>
      <tr><td valign="top" style="padding:4px 12px 0 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:bold;color:${INK};white-space:nowrap">Total paid</td><td align="right" valign="top" style="padding:4px 0 0 0;font-family:${SANS};font-size:16px;line-height:24px;font-weight:bold;color:${INK}">${escapeHtml(order.totalCents === 0 ? "Free" : formatAud(order.totalCents))}${order.totalCents === 0 ? "" : `<br><span style="font-size:13px;line-height:18px;font-weight:normal;color:${MUTED}">incl. booking fees</span>`}</td></tr>
    </table>`;
  const html = page({
    title: `You're in: ${event.title}`,
    preheader,
    header,
    body,
    after: `<img src="${EMAIL_FOOTER_IMAGE_URL}" width="600" alt="Sheltüh. Music. Art. Fashion. Culture." style="display:block;border:0;width:100%;max-width:600px;height:auto">`,
  });

  const inlineImages = [wordmarkImage(), ...qrs.flatMap((qr) => (qr ? [qr.image] : []))];
  return {
    to: order.buyerEmail ?? "",
    subject: subjectLine(`Your tickets: ${event.title}`),
    text,
    html,
    inlineImages,
  };
}

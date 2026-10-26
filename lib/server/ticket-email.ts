import { SUPPORT_EMAIL } from "@/lib/contact";
import { formatAud } from "@/lib/format";
import { directionsHref } from "@/lib/maps";
import { DEFAULT_REFUND_POLICY, REFUND_ACL_STATEMENT, refundTermsLine } from "@/lib/refund-policy";
import { formatSeatLine, speakSeatLine } from "@/lib/seating/format";
import { SUPPORT_LABEL } from "@/lib/support";
import { QR_QUIET_ZONE_MODULES, ticketQrLabel, ticketQrMatrix } from "@/lib/ticket-qr";
import { subjectLine, type EmailMessage, type InlineImage } from "./email";
import {
  brandFooter,
  button,
  escapeHtml,
  INK,
  LINE,
  MONO,
  MUTED,
  page,
  SANS,
  SIGNAL,
  WHITE,
  wordmarkHtml,
  wordmarkImage,
} from "./email-layout";
import { orderReference } from "./order-reference";
import { encodePng } from "./png";
import type { EventRecord, OrderRecord, TicketSeat, WalletAvailability } from "./types";

/**
 * The buyer's tickets email, sent once an order is paid (free orders included).
 *
 * On the shared layout (lib/server/email-layout.ts: one ivory column, table
 * markup, inline styles, a system font stack, Signal Orange only as a fill
 * with black text). Top to bottom: the wordmark, an orange "YOU'RE IN" label
 * and the event name as the heading; the event's image, full width, when it
 * has one; the date and time, venue, address and a "Get directions" link; a
 * white ticket panel per ticket (type, "Ticket n of N", seat, a dashed
 * perforation, the QR, "Show this code at the door.", the backup code and,
 * while the event is listed, "Add to Apple Wallet" / "Add to Google Wallet"
 * for each wallet the server has on: ticketWalletLinks);
 * the "View your ticket(s) →" button to the order's ticket page, with a text
 * fallback link; the order reference, any Support Sheltüh the buyer added
 * (its own line, lib/support.ts) and the total, which includes it; for a
 * paid order, the event's refund policy and the Australian Consumer Law line
 * (ticketEmailRefundPolicy);
 * "Need a hand?" with the support address; and the branded footer (the
 * footer image, once).
 *
 * Everything essential (event, when, where, every ticket code and seat, the
 * total) is real text, so it reads the same with images blocked; every image
 * has alt text.
 *
 * An event that's no longer published (unpublished, back in draft or review,
 * or rejected) gets EVENT_UNLISTED_TEXT instead of its date, time, venue,
 * address and image: the same rule as the ticket page (toCustomerOrder in
 * lib/server/records.ts) and the public event routes (`status = 'published'`).
 * The outbox rebuilds the email from the live event on every attempt and
 * resend, so a resent email follows the rule as it stands then.
 *
 * Images: the official wordmark (lib/server/email-wordmark.ts) and, for each
 * ticket whose code is a real one (`TICKET_CODE_PATTERN`), its QR code
 * (lib/ticket-qr.ts), both as inline PNG attachments (`cid:`), so they show
 * even where remote images are blocked (Outlook's default). The QR PNGs are
 * made here, each time the email is built: the outbox rebuilds the whole
 * message from the order on every attempt (lib/server/email-outbox.ts), so
 * nothing is stored. Two remote images, both on the site's own https origin
 * and neither carrying anything about the order or the buyer: the footer
 * image (public/brand/sheltuh-email-footer.png), and the event's own image
 * from the public, versioned `/api/events/{id}/image?v=…` route (published
 * events only, which is when that route serves it to anyone).
 */

const MELBOURNE_TZ = "Australia/Melbourne";

/**
 * QR size: 21 modules plus a 4-module quiet zone each side = 29 modules,
 * shown 8 px a module (232 px; it shrinks only when the screen is narrower).
 * The PNG has 16 px a module, so it's pixel-exact at 2x and sharp at 3x.
 */
const QR_DISPLAY_PX_PER_MODULE = 8;
const QR_PNG_PX_PER_MODULE = 16;

/** The event image's shown width: the column's full 600px (scaled down with it on a phone). */
const EVENT_IMAGE_WIDTH = 600;

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

/** Whether an event runs past the Melbourne day it starts on (overnight or multi-day). */
function spansDays(startIso: string, endIso?: string): boolean {
  return !!endIso && dayKey.format(new Date(startIso)) < endDayKey(endIso);
}

/** "Saturday 6 March 2027", or for several days "Friday 5 March – Saturday 6 March 2027". */
export function formatTicketDate(startIso: string, endIso?: string): string {
  const start = new Date(startIso);
  if (!endIso || !spansDays(startIso, endIso)) return longDateYear.format(start);
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
  if (!spansDays(startIso, endIso)) return `${time(startIso)} – ${time(endIso)} ${tz}`;
  return `${time(startIso)} (${shortWeekday.format(start)}) – ${time(endIso)} (${shortWeekday.format(end)}) ${zone(endIso) === tz ? tz : `${tz} / ${zone(endIso)}`}`;
}

/**
 * When, as the ticket email shows it: the date in bold, then for a same-day
 * event its time range ("7:00 pm – 11:00 pm AEDT"), and for an overnight or
 * multi-day event its start and end on their own lines, each with its day and
 * its own zone (so a run across a daylight-saving change is right at both
 * ends): "Starts Friday 5 March, 9:00 pm AEDT" / "Ends Sunday 7 March, 4:00 pm AEDT".
 */
export function ticketWhen(startIso: string, endIso?: string): { date: string; lines: string[] } {
  const date = formatTicketDate(startIso, endIso);
  if (!endIso || !spansDays(startIso, endIso)) return { date, lines: [formatTicketTime(startIso, endIso)] };
  const at = (iso: string) => `${longDate.format(new Date(iso))}, ${time(iso)} ${zone(iso)}`;
  return { date, lines: [`Starts ${at(startIso)}`, `Ends ${at(endIso)}`] };
}

export { orderReference };

// --- Links ---

/** The order's ticket page: /checkout/success for this order (the order id is its credential). */
export function ticketPageLink(siteUrl: string, orderId: string): string {
  return `${siteUrl}/checkout/success?session_id=${encodeURIComponent(orderId)}`;
}

/**
 * One ticket's "Add to … Wallet" route (lib/server/handlers/wallet.ts), by the
 * same capability as ticketPageLink. `ticketNumber` is the ticket's number in
 * the email and on the ticket page (1-based, ticket type then code), which is
 * the route's `?ticket=`; never the ticket's code.
 */
export function walletPassLink(siteUrl: string, orderId: string, provider: "apple" | "google", ticketNumber: number): string {
  return `${siteUrl}/api/orders/by-session/${encodeURIComponent(orderId)}/wallet/${provider}?ticket=${ticketNumber}`;
}

/** No wallet passes: buildTicketEmail's default, when the caller doesn't say which wallets are on. */
const NO_WALLET: WalletAvailability = { google: false, apple: false };

/**
 * Ticket `index`'s (0-based) wallet links for the email, Apple then Google,
 * or none: only for a paid order of a listed (published) event, the wallet
 * pass routes' own rule (walletEligible in ./handlers/orders.ts; they 404
 * otherwise), and only for the wallets `wallet` says are on (the outbox
 * passes Deps.googleWallet / appleWallet). The outbox rebuilds the email on
 * every attempt and resend, so the links follow the event and configuration
 * as they stand then.
 */
export function ticketWalletLinks(
  order: Pick<OrderRecord, "orderId" | "status">,
  event: Pick<EventRecord, "status">,
  siteUrl: string,
  wallet: WalletAvailability,
  index: number,
): { label: string; href: string }[] {
  if (order.status !== "paid" || event.status !== "published") return [];
  return [
    ...(wallet.apple ? [{ label: "Add to Apple Wallet", href: walletPassLink(siteUrl, order.orderId, "apple", index + 1) }] : []),
    ...(wallet.google ? [{ label: "Add to Google Wallet", href: walletPassLink(siteUrl, order.orderId, "google", index + 1) }] : []),
  ];
}

/**
 * The event image's absolute URL for the email, or null: only for a
 * same-origin path (the API's `/api/events/{id}/image?v=…`) on an https site,
 * so a mail client (or Gmail's image proxy) can fetch it without signing in,
 * and never a URL pointing anywhere else.
 */
export function eventImageEmailUrl(siteUrl: string, imageUrl: string | undefined): string | null {
  if (!imageUrl || !imageUrl.startsWith("/") || imageUrl.startsWith("//") || imageUrl.includes("\\")) return null;
  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return null;
  }
  if (site.protocol !== "https:") return null;
  const url = new URL(imageUrl, site.origin);
  return url.origin === site.origin ? url.href : null;
}

/**
 * "Get directions" (the event page's own link, lib/maps.ts: Google Maps,
 * routing to the venue's name and address), or null when there's no address
 * or suburb to route to (a venue name alone, like "Secret location", isn't
 * enough).
 */
export function ticketDirectionsLink(event: Pick<EventRecord, "venueName" | "venueAddress" | "suburb">): string | null {
  const venueName = event.venueName?.trim() ?? "";
  const venueAddress = event.venueAddress?.trim() ?? "";
  const suburb = event.suburb?.trim() ?? "";
  if (!venueAddress && !suburb) return null;
  return directionsHref({ venueName, venueAddress, suburb });
}

/**
 * What the email says, in place of the date, time, venue and address, when
 * the event isn't published any more (unpublished, back in draft or review,
 * or rejected): its details are no longer public, and may no longer be right.
 * The tickets still go out. The same rule as the ticket page (toCustomerOrder).
 */
export const EVENT_UNLISTED_TEXT = `This event is no longer listed. Contact ${SUPPORT_EMAIL} if you have questions.`;

// --- QR codes ---

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

// --- HTML pieces ---

const text = (size: number, lineHeight: number, colour: string, extra = "") =>
  `font-family:${SANS};font-size:${size}px;line-height:${lineHeight}px;color:${colour}${extra ? `;${extra}` : ""}`;

/** A paragraph (`html` is trusted markup: escape anything dynamic first). */
const para = (html: string, style: string, margin = "0") => `<p style="margin:${margin};${style}">${html}</p>`;

/** "Ticket 1 of 3", the ticket type before it when there is one: "VIP · Ticket 1 of 3". */
function ticketLine(typeName: string, index: number, total: number): string {
  const number = `Ticket ${index + 1} of ${total}`;
  return typeName ? `${typeName} · ${number}` : number;
}

/**
 * One ticket's panel: white, a thin black border with modest rounding, "Your
 * ticket", its type and number, its seat (reserved seating), a dashed
 * perforation, the QR centred on white (the PNG carries its own white quiet
 * zone; nothing is drawn over it), "Show this code at the door." and the
 * backup code as selectable text ("Entry code", larger, when there's no QR),
 * then its wallet links, if any (ticketWalletLinks), as underlined text links.
 */
function ticketPanel(
  code: string,
  typeName: string,
  index: number,
  total: number,
  qr: TicketQr | null,
  seat?: TicketSeat,
  walletLinks: { label: string; href: string }[] = [],
): string {
  const qrRow = qr
    ? `<tr><td align="center" bgcolor="${WHITE}" style="padding:24px 16px 0 16px;background-color:${WHITE}"><img src="cid:${escapeHtml(qr.image.cid)}" width="${qr.px}" height="${qr.px}" alt="${escapeHtml(qr.alt)}" style="display:block;border:0;width:${qr.px}px;max-width:100%;height:auto;image-rendering:pixelated;-ms-interpolation-mode:nearest-neighbor;background-color:${WHITE};${text(13, 18, INK)}"></td></tr>\n`
    : "";
  const codeStyle = qr
    ? text(18, 26, INK, `font-family:${MONO};font-weight:bold;letter-spacing:2px;word-break:break-all`)
    : text(24, 32, INK, `font-family:${MONO};font-weight:bold;letter-spacing:2px;word-break:break-all`);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${WHITE}" class="ticket" style="background-color:${WHITE};border:1px solid ${INK};border-radius:8px;border-collapse:separate;margin:0 0 16px 0">
<tr><td class="tpx" style="padding:18px 20px 16px 20px">${para("Your ticket", text(18, 24, INK, "font-weight:bold"))}${para(escapeHtml(ticketLine(typeName, index, total)), text(16, 24, MUTED), "2px 0 0 0")}${seat ? para(escapeHtml(formatSeatLine(seat)), text(16, 24, INK, "font-weight:bold"), "4px 0 0 0") : ""}</td></tr>
<tr><td style="border-top:1px dashed ${MUTED};font-size:0;line-height:0;height:0">&nbsp;</td></tr>
${qrRow}<tr><td align="center" class="tpx" style="padding:${qr ? 16 : 20}px 20px 20px 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td align="center" style="${text(16, 24, INK, "font-weight:bold")}">Show this code at the door.</td></tr>
<tr><td align="center" style="padding:8px 0 0 0;${text(14, 20, MUTED)}">${qr ? "Backup code" : "Entry code"}</td></tr>
<tr><td align="center" style="${codeStyle}">${escapeHtml(code)}</td></tr>
${walletLinks.length ? `<tr><td align="center" style="padding:12px 0 0 0;${text(14, 20, INK)}">${walletLinks.map((l) => `<a href="${escapeHtml(l.href)}" style="color:${INK};text-decoration:underline">${escapeHtml(l.label)}</a>`).join(" &middot; ")}</td></tr>\n` : ""}</table></td></tr>
</table>`;
}

/**
 * The event's refund policy for the email (lib/refund-policy.ts), or null:
 * only for an order that cost something (nothing to refund on a free one), of
 * a listed event (the same rule as the ticket page's details), ticketed on
 * Sheltüh (another site's terms apply to an external event). The event is the
 * live one the outbox loads on every attempt (findEventById), so a resend
 * says the policy as it stands then; it can only have become more generous
 * since the order (an event with orders can't be tightened). A `days_before`
 * policy is said against the event's start and `now` (when the email is
 * built): the date and time refunds close, in Melbourne time like the rest of
 * the email, or that they have (lib/refund-policy.ts, refundTermsLine).
 */
export function ticketEmailRefundPolicy(
  order: Pick<OrderRecord, "totalCents">,
  event: EventRecord,
  now: Date = new Date(),
): string | null {
  if (order.totalCents <= 0 || event.status !== "published" || event.ticketingMode === "external") return null;
  return refundTermsLine(event.refundPolicy ?? DEFAULT_REFUND_POLICY, event.refundDays, event.startsAt, {
    timeZone: MELBOURNE_TZ,
    now,
  });
}

/** The orange "YOU'RE IN" label: black text on Signal Orange (6.18:1), 14px bold, barely tracked. */
const YOURE_IN_LABEL = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 12px 0"><tr><td bgcolor="${SIGNAL}" style="background-color:${SIGNAL};border-radius:4px;padding:4px 10px;${text(14, 20, INK, "font-weight:bold;letter-spacing:0.5px")}">YOU&rsquo;RE IN</td></tr></table>`;

/**
 * The sent email: one 600px-max column, with a plain-text alternative. `now`
 * (when it's built) dates the refund policy (ticketEmailRefundPolicy);
 * `wallet` says which wallets' passes are on, for each ticket's wallet links
 * (ticketWalletLinks; none by default).
 */
export function buildTicketEmail(
  order: OrderRecord,
  event: EventRecord,
  siteUrl: string,
  now: Date = new Date(),
  wallet: WalletAvailability = NO_WALLET,
): EmailMessage {
  const link = ticketPageLink(siteUrl, order.orderId);
  const one = order.tickets.length === 1;
  // /checkout/success lists every ticket code, so the button can say "tickets".
  const buttonLabel = one ? "View your ticket" : "View your tickets";
  // Only a published event's details go out (the outbox passes the live event on every attempt and resend).
  const listed = event.status === "published";
  const when = listed ? ticketWhen(event.startsAt, event.endsAt) : null;
  const venue = listed ? (event.venueName?.trim() ?? "") : "";
  const address = listed ? (event.venueAddress?.trim() || event.suburb?.trim() || "") : "";
  const directions = listed ? ticketDirectionsLink(event) : null;
  const imageUrl = listed ? eventImageEmailUrl(siteUrl, event.imageUrl) : null;
  const reference = orderReference(order.orderId);
  const free = order.totalCents === 0;
  // Support Sheltüh the buyer added (paid orders only): its own line above the total, which includes it.
  const support = !free && order.supportCents && order.supportCents > 0 ? order.supportCents : 0;
  const includes = support ? `incl. booking fees and ${SUPPORT_LABEL}` : "incl. booking fees";
  const totalText = free ? "Free" : `${formatAud(order.totalCents)} (${includes})`;
  const qrs = order.tickets.map((t, i) => ticketQr(t.ticketCode, i));
  const anyQr = qrs.some((qr) => qr !== null);
  const total = order.tickets.length;
  const refunds = ticketEmailRefundPolicy(order, event, now);
  const walletLinks = (i: number) => ticketWalletLinks(order, event, siteUrl, wallet, i);

  // --- Plain text ---
  const plain = [
    "SHELTÜH",
    "",
    "YOU'RE IN",
    event.title,
    "",
    ...(when
      ? [
          `Date: ${when.date}`,
          ...(when.lines.length === 1 ? [`Time: ${when.lines[0]}`] : when.lines.map((line) => line.replace(/^(Starts|Ends) /, "$1: "))),
          ...(venue ? [`Venue: ${venue}`] : []),
          ...(address ? [`Address: ${address}`] : []),
          ...(directions ? [`Get directions: ${directions}`] : []),
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
      `Ticket ${i + 1} of ${total}${t.ticketTypeName ? ` - ${t.ticketTypeName}` : ""}`,
      ...(t.seat ? [`Seat: ${speakSeatLine(t.seat)}`] : []),
      `Entry code: ${t.ticketCode}`,
      ...walletLinks(i).map((l) => `${l.label}: ${l.href}`),
    ]),
    "",
    `${buttonLabel}: ${link}`,
    "",
    `Order reference: ${reference}`,
    ...(support ? [`${SUPPORT_LABEL}: ${formatAud(support)}`] : []),
    `Total paid: ${totalText}`,
    ...(refunds ? ["", `Refund policy: ${refunds}`, REFUND_ACL_STATEMENT] : []),
    "",
    `Need a hand? Email ${SUPPORT_EMAIL}`,
    "Sheltüh, Melbourne",
  ].join("\n");

  // --- HTML ---
  const header =
    wordmarkHtml +
    YOURE_IN_LABEL +
    `<h1 class="h1" style="margin:0;${text(32, 38, INK, "font-weight:bold;overflow-wrap:break-word;word-wrap:break-word")}">${escapeHtml(event.title)}</h1>`;

  // The event's own image, full width, its proportions kept (height:auto; no height attribute, as its
  // size isn't stored). Left out entirely when there's none. Alt text names it; nothing essential is in it.
  const hero = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" width="${EVENT_IMAGE_WIDTH}" alt="${escapeHtml(`Event image for ${event.title}`)}" style="display:block;border:0;width:100%;max-width:${EVENT_IMAGE_WIDTH}px;height:auto;${text(14, 20, INK)}">`
    : undefined;

  const details = when
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0">
<tr><td style="padding:0 0 ${venue || address ? 18 : 0}px 0">${para(escapeHtml(when.date), text(17, 24, INK, "font-weight:bold"))}${when.lines.map((line) => para(escapeHtml(line), text(16, 24, MUTED), "2px 0 0 0")).join("")}</td></tr>
${
  venue || address
    ? `<tr><td>${venue ? para(escapeHtml(venue), text(17, 24, INK, "font-weight:bold")) : ""}${address ? para(escapeHtml(address), text(16, 24, venue ? MUTED : INK), venue ? "2px 0 0 0" : "0") : ""}${
        directions
          ? para(
              `<a href="${escapeHtml(directions)}" style="color:${INK};text-decoration:underline">Get directions&nbsp;&#8599;</a>`,
              text(16, 24, INK, "font-weight:bold"),
              "6px 0 0 0",
            )
          : ""
      }</td></tr>\n`
    : ""
}</table>`
    : para(
        `This event is no longer listed. Contact <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${INK};text-decoration:underline">${escapeHtml(SUPPORT_EMAIL)}</a> if you have questions.`,
        text(16, 24, INK),
        "0 0 24px 0",
      );

  const panels = order.tickets
    .map((t, i) => ticketPanel(t.ticketCode, t.ticketTypeName, i, total, qrs[i], t.seat, walletLinks(i)))
    .join("\n");
  const tip = anyQr
    ? para(
        `Turn your screen brightness up. If ${one ? "the" : "a"} QR code won&rsquo;t scan, door staff can type in ${one ? "the" : "its"} backup code.`,
        text(14, 20, MUTED),
        "0 0 20px 0",
      )
    : "";
  const fallback = para(
    `Button not working? <a href="${escapeHtml(link)}" style="color:${INK};text-decoration:underline">Open your ${one ? "ticket" : "tickets"} here</a>.`,
    text(14, 20, MUTED, "text-align:center"),
    "0",
  );
  const summary = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${LINE};border-bottom:1px solid ${LINE};margin:28px 0 0 0">
<tr><td style="padding:14px 12px 4px 0;${text(15, 22, MUTED, "white-space:nowrap")}">Order reference</td><td align="right" style="padding:14px 0 4px 0;${text(15, 22, INK, `font-family:${MONO}`)}">${escapeHtml(reference)}</td></tr>
${support ? `<tr><td style="padding:4px 12px 4px 0;${text(15, 22, MUTED, "white-space:nowrap")}">${escapeHtml(SUPPORT_LABEL)}</td><td align="right" style="padding:4px 0 4px 0;${text(15, 22, INK)}">${escapeHtml(formatAud(support))}</td></tr>\n` : ""}<tr><td valign="top" style="padding:4px 12px 14px 0;${text(16, 24, INK, "font-weight:bold;white-space:nowrap")}">Total paid</td><td align="right" valign="top" style="padding:4px 0 14px 0;${text(16, 24, INK, "font-weight:bold")}">${escapeHtml(free ? "Free" : formatAud(order.totalCents))}${free ? "" : `<br><span style="font-size:14px;line-height:20px;font-weight:normal;color:${MUTED}">${escapeHtml(includes)}</span>`}</td></tr>
</table>`;
  // Under the summary: the policy in black, the ACL line muted.
  const refundNote = refunds
    ? para(
        `<span style="font-weight:bold">Refund policy:</span> ${escapeHtml(refunds)}`,
        text(15, 22, INK),
        "14px 0 0 0",
      ) + para(escapeHtml(REFUND_ACL_STATEMENT), text(14, 20, MUTED), "4px 0 0 0")
    : "";

  const body = `${details}
${panels}
${tip}${button(`${buttonLabel} →`, link, "4px 0 12px 0", true)}
${fallback}
${summary}${refundNote}`;

  const preheader = `Your ${one ? "ticket" : "tickets"} for ${event.title}. Show your ${anyQr ? "QR code" : "entry code"} at the door.`;
  const html = page({
    title: `You're in: ${event.title}`,
    preheader,
    header,
    hero,
    body,
    footer: brandFooter(
      siteUrl,
      `Need a hand? <a href="mailto:${escapeHtml(SUPPORT_EMAIL)}" style="color:${INK};text-decoration:underline">${escapeHtml(SUPPORT_EMAIL)}</a>`,
    ),
  });

  const inlineImages = [wordmarkImage(), ...qrs.flatMap((qr) => (qr ? [qr.image] : []))];
  return {
    to: order.buyerEmail ?? "",
    subject: subjectLine(`Your tickets: ${event.title}`),
    text: plain,
    html,
    inlineImages,
  };
}

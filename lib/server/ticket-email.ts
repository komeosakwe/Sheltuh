import { eventPublicLink, inviteText, tellAFriendLinks } from "./share-email";
import { googleCalendarUrl, outlookCalendarUrl, type CalendarEvent } from "@/lib/calendar";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { eventCalendarPath, organiserPageLink } from "@/lib/event-url";
import { calculateOrderSummary } from "@/lib/fees";
import { formatAudExact, formatEventDateShort } from "@/lib/format";
import { directionsHref } from "@/lib/maps";
import { placeName, placeNameParts } from "@/lib/place";
import { DEFAULT_REFUND_POLICY, REFUND_ACL_STATEMENT, refundTermsLine } from "@/lib/refund-policy";
import { formatSeatLine, speakSeatLine } from "@/lib/seating/format";
import { SUPPORT_LABEL, SUPPORT_REFUND_NOTE } from "@/lib/support";
import { ticketNameWithGroup } from "@/lib/ticket-groups";
import { TICKET_CODE_PATTERN } from "@/lib/ticket-code";
import { ticketQrLabel } from "@/lib/ticket-qr";
import { appleWalletDeviceNote, WALLET_BADGES } from "@/lib/wallet-badges";
import { cachedDateTimeFormat, PLATFORM_TIME_ZONE, zoneLabel, type StateCode } from "@/lib/time-zones";
import { subjectLine, type EmailMessage, type InlineImage } from "./email";
import { escapeHtml } from "./email-layout";
import {
  KIT,
  type KitDetailRow,
  kitButtons,
  kitDetails,
  kitFooter,
  kitFooterText,
  kitHeader,
  kitHelp,
  kitHelpText,
  kitIntro,
  kitPage,
  kitStack,
  kitSummary,
  kitTellAFriend,
  kitTicketCard,
} from "./email-kit";
import {
  MONO,
  SANS,
  TICKET_EMAIL_ASSETS,
  TICKET_EMAIL_COLOURS,
  TICKET_EMAIL_WALLET_BADGES,
  TICKET_PHONE_RULES,
  ticketAssetUrl,
  ticketWordmarkImage,
} from "./email-ticket-layout";
import { orderReference } from "./order-reference";
import { TICKET_QR_MODULES, ticketQrPng } from "./qr-image";
import type { EventRecord, IssuedTicket, OrderRecord, TicketSeat, WalletAvailability } from "./types";

/**
 * The buyer's tickets email, sent once an order is paid (free orders
 * included): "You're in. Here's your ticket." (docs/design/ticket-email.md,
 * built one-to-one with the owner's design images; the deviations are listed
 * in its §2).
 *
 * On the shared layout (lib/server/email-kit.ts, Latte's 1120 frames: a
 * white column on the customer cream, Instrument Sans and IBM Plex Mono with
 * Arial / Courier New fallbacks, bulletproof tables, light only); only the
 * full ticket card is this file's own (ticketCard). Top to bottom: the
 * wordmark; the "Order {reference} · Confirmed" eyebrow and the headline
 * ("Hi, you're in. Here's your ticket.", or "You're in." for a free order);
 * one full ticket card, the first ticket's (corner stripes and "ADMIT ONE ·
 * SHELTÜH", the event's image, title and venue line, a perforation with a
 * notch each side, DATE / TIME / TICKET, the seat, the QR with the centre ü,
 * the backup code and "Show this at the door · ticket 1 of N"); with several
 * tickets, a cream row for each of the others ("TICKET n of N", the buyer's
 * name and the ticket type, View: Latte's 2-ticket frame, owner decision; no
 * code or QR, the ticket page holds them) and OTHER_TICKETS_NOTE; the first
 * ticket's "Add to Apple / Google Wallet" buttons when the wallets are on
 * (ticketWalletLinks); "View your ticket(s)" and "Manage order" (both the
 * order's ticket page, the link earlier emails carried); the date, venue,
 * event info and "Hosted by" rows (with Google / Apple / Outlook calendar
 * links, Get directions and the organiser's page); the order summary
 * (reference, order date, each line's amount, the booking fee where itemised,
 * Support Sheltüh, the total, and for a paid order the refund policy with the
 * shared Australian Consumer Law sentence); "Going with friends?" (WhatsApp,
 * Messages, Email, Share page); "Need a hand?"; and the shared footer, whose
 * reason says the buyer bought (or, free, got) a ticket.
 *
 * Everything essential (event, when, where, the first ticket's code and every
 * seat, the total) is real text, so it reads the same with images blocked; every image
 * has alt text (`alt=""` on the decorative ones).
 *
 * An event that's no longer published (unpublished, back in draft or review,
 * or rejected) gets EVENT_UNLISTED_TEXT instead of its date, time, venue,
 * address, image and links, and no wallet buttons: the same rule as the
 * ticket page (toCustomerOrder in lib/server/records.ts) and the public event
 * routes. The outbox rebuilds the email from the live event on every attempt
 * and resend, so a resent email follows the rule as it stands then.
 *
 * Images: the wordmark and, when the first ticket's code is a real one, its QR
 * (lib/server/qr-image.ts), as inline PNG attachments (`cid:`), built fresh
 * on every attempt, nothing stored. Remote images, all on the site's own
 * origin and none carrying anything about the order or the buyer: the
 * decorative stripes, notches and icons (public/email/ticket/), and the
 * event's own image from the public, versioned `/api/events/{id}/image?v=…`
 * route (published events only, https sites only).
 *
 * Size: Gmail clips a message whose HTML passes 102KB. When a row for every
 * other ticket would take the HTML past TICKET_EMAIL_HTML_BUDGET (90KB: the
 * largest order checkout allows is 20 ticket types of 20 people), the first
 * of them get rows and the rest are one line pointing at the ticket page.
 * The plain-text part has a line for every ticket, and only the first code.
 */

const MELBOURNE_TZ = PLATFORM_TIME_ZONE;

/**
 * QR size: 25 modules (version 2, level H, with the centre ü) plus a 4-module
 * quiet zone each side = 33 modules, shown 8 px a module (264 px; 7 px, 231,
 * on a phone). The PNG has 16 px a module (lib/server/qr-image.ts), so it's
 * pixel-exact at 2x and sharp at 3x. The quiet zone is the white margin
 * around the code (owner decision P2): 32 px above the backup code.
 */
const QR_DISPLAY_PX_PER_MODULE = 8;

/** The ticket's content width (600 - 2 x 32 page - 2 x 8 border - 2 x 28 padding): the event image's shown width. */
const CARD_CONTENT_WIDTH = 464;

/** Gmail clips HTML over 102KB (inline images don't count): stay under this, with room to spare. */
export const TICKET_EMAIL_HTML_BUDGET = 90 * 1024;

// --- Dates and times (in the event's zone: Melbourne unless it has another) ---

/**
 * The zone an event's times are shown in (EventRecord.timeZone; absent:
 * Melbourne) and its state, which names the ACT's zone "Canberra time"
 * (zoneLabel). An EventRecord is one.
 */
export interface EventZone {
  timeZone?: string;
  state?: StateCode | null;
}

interface ZoneFormats {
  dayKey: Intl.DateTimeFormat;
  longDate: Intl.DateTimeFormat;
  longDateYear: Intl.DateTimeFormat;
  shortWeekday: Intl.DateTimeFormat;
  clock: Intl.DateTimeFormat;
  zoneName: Intl.DateTimeFormat;
}

/** The formatters for a zone (each built once per process: cachedDateTimeFormat). */
function formatsFor(timeZone: string): ZoneFormats {
  return {
    dayKey: cachedDateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }),
    longDate: cachedDateTimeFormat("en-AU", { timeZone, weekday: "long", day: "numeric", month: "long" }),
    longDateYear: cachedDateTimeFormat("en-AU", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    shortWeekday: cachedDateTimeFormat("en-AU", { timeZone, weekday: "short" }),
    clock: cachedDateTimeFormat("en-AU", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }),
    zoneName: cachedDateTimeFormat("en-AU", { timeZone, timeZoneName: "short" }),
  };
}

const zoneOf = (where: EventZone) => where.timeZone ?? MELBOURNE_TZ;

function time(iso: string, where: EventZone): string {
  return formatsFor(zoneOf(where)).clock.format(new Date(iso)).toLowerCase();
}

/**
 * The zone as the email names it at `iso`: Melbourne's abbreviation alone
 * ("AEDT", as every email has always said it), any other zone's full label
 * ("Perth time (AWST)", "Canberra time (AEDT)", "Lord Howe Island time
 * (UTC+11:00)": zoneLabel), so a reader in another state knows whose time it is.
 */
function zone(iso: string, where: EventZone): string {
  const timeZone = zoneOf(where);
  if (timeZone !== MELBOURNE_TZ) return zoneLabel(timeZone, iso, where.state);
  return formatsFor(timeZone).zoneName.formatToParts(new Date(iso)).find((p) => p.type === "timeZoneName")?.value ?? "Melbourne time";
}

/**
 * The calendar day (in the event's zone) an event's end belongs to. An end
 * at exactly 12:00 am closes the previous day ("8:00 pm – 12:00 am" on one date).
 */
function endDayKey(endIso: string, where: EventZone): string {
  const { clock, dayKey } = formatsFor(zoneOf(where));
  const end = new Date(endIso);
  const justBefore = new Date(end.getTime() - 60_000);
  return clock.format(end) === "12:00 am" ? dayKey.format(justBefore) : dayKey.format(end);
}

/** Whether an event runs past the day it starts on, in its zone (overnight or multi-day). */
function spansDays(startIso: string, endIso: string | undefined, where: EventZone): boolean {
  return !!endIso && formatsFor(zoneOf(where)).dayKey.format(new Date(startIso)) < endDayKey(endIso, where);
}

/**
 * "Saturday 6 March 2027", or for several days "Friday 5 March – Saturday 6
 * March 2027": the days in the event's zone (`where`; Melbourne by default).
 */
export function formatTicketDate(startIso: string, endIso?: string, where: EventZone = {}): string {
  const { clock, dayKey, longDate, longDateYear } = formatsFor(zoneOf(where));
  const start = new Date(startIso);
  if (!endIso || !spansDays(startIso, endIso, where)) return longDateYear.format(start);
  const end = new Date(new Date(endIso).getTime() - (clock.format(new Date(endIso)) === "12:00 am" ? 60_000 : 0));
  const sameYear = dayKey.format(start).slice(0, 4) === dayKey.format(end).slice(0, 4);
  return `${sameYear ? longDate.format(start) : longDateYear.format(start)} – ${longDateYear.format(end)}`;
}

/**
 * "8:00 pm – 11:00 pm AEDT" for a same-day event in Melbourne ("8:00 pm –
 * 11:00 pm Perth time (AWST)" in Perth). An event that crosses midnight
 * (judged in its zone, not UTC) names the days: "9:00 pm (Fri) – 2:00 am
 * (Sat) AEDT".
 */
export function formatTicketTime(startIso: string, endIso?: string, where: EventZone = {}): string {
  const { shortWeekday } = formatsFor(zoneOf(where));
  const start = new Date(startIso);
  const tz = zone(startIso, where);
  if (!endIso) return `${time(startIso, where)} ${tz}`;
  const end = new Date(endIso);
  if (!spansDays(startIso, endIso, where)) return `${time(startIso, where)} – ${time(endIso, where)} ${tz}`;
  const endTz = zone(endIso, where);
  return `${time(startIso, where)} (${shortWeekday.format(start)}) – ${time(endIso, where)} (${shortWeekday.format(end)}) ${endTz === tz ? tz : `${tz} / ${endTz}`}`;
}

/**
 * When, as the ticket email shows it: the date in bold, then for a same-day
 * event its time range ("7:00 pm – 11:00 pm AEDT"), and for an overnight or
 * multi-day event its start and end on their own lines, each with its day and
 * its own zone (so a run across a daylight-saving change is right at both
 * ends): "Starts Friday 5 March, 9:00 pm AEDT" / "Ends Sunday 7 March, 4:00 pm AEDT".
 * In the event's zone (`where`; Melbourne by default).
 */
export function ticketWhen(startIso: string, endIso?: string, where: EventZone = {}): { date: string; lines: string[] } {
  const date = formatTicketDate(startIso, endIso, where);
  if (!endIso || !spansDays(startIso, endIso, where)) return { date, lines: [formatTicketTime(startIso, endIso, where)] };
  const { longDate } = formatsFor(zoneOf(where));
  const at = (iso: string) => `${longDate.format(new Date(iso))}, ${time(iso, where)} ${zone(iso, where)}`;
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

/** One wallet link: which wallet, the vendor's wording, and the pass route. */
export interface WalletLink {
  provider: "apple" | "google";
  label: string;
  href: string;
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
): WalletLink[] {
  if (order.status !== "paid" || event.status !== "published") return [];
  return [
    ...(wallet.apple ? [{ provider: "apple" as const, label: WALLET_BADGES.apple.label, href: walletPassLink(siteUrl, order.orderId, "apple", index + 1) }] : []),
    ...(wallet.google ? [{ provider: "google" as const, label: WALLET_BADGES.google.label, href: walletPassLink(siteUrl, order.orderId, "google", index + 1) }] : []),
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
 * "Get directions" (the event page's own link, lib/maps.ts directionsHref:
 * Google Maps, routing to the venue's linked Google place when it has one,
 * else the organiser's pin, else the venue's name and address), or null when
 * there's nothing to route to: no address or suburb, and no place or pin (a
 * venue name alone, like "Secret location", isn't enough).
 */
export function ticketDirectionsLink(
  event: Pick<EventRecord, "venueName" | "venueAddress" | "suburb"> & Partial<Pick<EventRecord, "state" | "location">>,
): string | null {
  const venueName = event.venueName?.trim() ?? "";
  const venueAddress = event.venueAddress?.trim() ?? "";
  const suburb = event.suburb?.trim() ?? "";
  const location = event.location;
  if (!venueAddress && !suburb && !location?.placeId && !location?.pin) return null;
  return directionsHref({
    venueName,
    venueAddress,
    suburb,
    ...(event.state ? { state: event.state } : {}),
    ...(location?.placeId ? { venuePlaceId: location.placeId } : {}),
    ...(location?.pin ? { venuePinned: true, coordinates: { lat: location.pin.lat, lng: location.pin.lng } } : {}),
  });
}

/**
 * What the email says, in place of the date, time, venue and address, when
 * the event isn't published any more (unpublished, back in draft or review,
 * or rejected): its details are no longer public, and may no longer be right.
 * The tickets still go out. The same rule as the ticket page (toCustomerOrder).
 */
export const EVENT_UNLISTED_TEXT = `This event is no longer listed. Contact ${SUPPORT_EMAIL} if you have questions.`;

// --- Times as the design writes them (docs/design/ticket-email.md §5.2) ---

interface Clock {
  hour: string;
  minute: string;
  meridiem: string;
}

/** "7:30 pm" in the event's zone, as its parts. */
function clock(iso: string, where: EventZone): Clock {
  const shown = time(iso, where);
  const match = /^(\d{1,2}):(\d{2})[\s  ]*([ap]m)$/.exec(shown);
  return match ? { hour: match[1], minute: match[2], meridiem: match[3] } : { hour: shown, minute: "", meridiem: "" };
}

/** "5" for 5:00, "7:30" for 7:30. */
const compact = (c: Clock) => (c.minute === "00" || c.minute === "" ? c.hour : `${c.hour}:${c.minute}`);

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The ticket stub's TIME, as the design writes it: "5–9 pm" (one meridiem),
 * "7:30–11 pm", "11 am–2 pm", "5 pm" (no end), "9 pm–2 am" (overnight: the
 * day is in DATE). No spaces round the en dash; one before am / pm. An event
 * that runs a day or more shows its start alone (its days are in the When
 * row). In the event's zone (`where`; Melbourne by default).
 */
export function formatStubTime(startIso: string, endIso?: string, where: EventZone = {}): string {
  const start = clock(startIso, where);
  const alone = `${compact(start)} ${start.meridiem}`.trim();
  if (!endIso) return alone;
  const overnight = spansDays(startIso, endIso, where);
  if (overnight && new Date(endIso).getTime() - new Date(startIso).getTime() >= DAY_MS) return alone;
  const end = clock(endIso, where);
  if (!overnight && start.meridiem === end.meridiem) return `${compact(start)}–${compact(end)} ${end.meridiem}`;
  return `${alone}–${compact(end)} ${end.meridiem}`;
}

/**
 * The When row's time line: "5:00 – 9:00 pm AEDT" when both times share a
 * meridiem on the same day (the first one dropped, spaces round the en
 * dash), otherwise formatTicketTime ("11:00 am – 2:00 pm AEDT", "5:00 pm
 * AEDT"). An overnight or multi-day event keeps ticketWhen's Starts / Ends
 * lines instead.
 */
export function formatInfoTime(startIso: string, endIso?: string, where: EventZone = {}): string {
  if (!endIso || spansDays(startIso, endIso, where)) return formatTicketTime(startIso, endIso, where);
  const start = clock(startIso, where);
  const end = clock(endIso, where);
  if (start.meridiem !== end.meridiem || !start.minute) return formatTicketTime(startIso, endIso, where);
  return `${start.hour}:${start.minute} – ${end.hour}:${end.minute} ${end.meridiem} ${zone(startIso, where)}`;
}

/** The When row: the date, then its time line (or, overnight or multi-day, its Starts / Ends lines). */
export function ticketEmailWhen(startIso: string, endIso?: string, where: EventZone = {}): { date: string; lines: string[] } {
  const when = ticketWhen(startIso, endIso, where);
  return when.lines.length === 1 ? { date: when.date, lines: [formatInfoTime(startIso, endIso, where)] } : when;
}

// --- Places ---

/** The suburb as shown on its own ("Coburg North"), and the state ("VIC"), or null without a suburb. */
function suburbParts(event: Pick<EventRecord, "suburb" | "state">) {
  return placeNameParts(event.suburb ?? "", event.state);
}

/**
 * The ticket's venue line: "{venue} · {suburb}", or whichever exists, or ""
 * (printed in capitals by the email's CSS; the text stays as entered).
 */
export function ticketVenueLine(event: Pick<EventRecord, "venueName" | "suburb" | "state">): string {
  return [event.venueName?.trim() ?? "", suburbParts(event)?.suburb ?? ""].filter(Boolean).join(" · ");
}

/**
 * The Where row's address: "16 Catherine St, Coburg North VIC" (the suburb
 * left out when the address already names it, as the wallet pass does, and
 * the state left out when it's already there); with no street address, the
 * suburb as "Suburb, STATE" (placeName, owner decision D4); or "".
 */
export function ticketAddressLine(event: Pick<EventRecord, "venueAddress" | "suburb" | "state">): string {
  const address = event.venueAddress?.trim() ?? "";
  const parts = suburbParts(event);
  if (!address) return placeName(event.suburb ?? "", event.state);
  if (!parts) return address;
  const named = (text: string, word: string) => new RegExp(`(^|[\\s,])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s,])`, "i").test(text);
  const withSuburb = named(address, parts.suburb) ? address : `${address}, ${parts.suburb}`;
  return named(withSuburb, parts.state) ? withSuburb : `${withSuburb} ${parts.state}`;
}

// --- QR codes ---

export interface TicketQr {
  /** The inline attachment's id and file name (never the code). */
  cid: string;
  filename: string;
  /** Shown width and height on a desktop, in CSS pixels (231 on a phone). */
  px: number;
  alt: string;
  code: string;
}

/**
 * A QR's alt text: what it is, and what to do when it doesn't show (images
 * blocked or not loaded): the backup code printed beneath it.
 */
export function ticketQrAlt(code: string): string {
  return `${ticketQrLabel(code)}. If it doesn't show, use the backup code below.`;
}

/**
 * Where the ticket's QR goes, or null when the code isn't a real one (the
 * rule ticketQrSymbol applies). The PNG itself (with the centre ü,
 * lib/server/qr-image.ts) is only made for the cards the email shows
 * (qrImage).
 */
export function ticketQr(code: string, index: number): TicketQr | null {
  if (typeof code !== "string" || !TICKET_CODE_PATTERN.test(code)) return null;
  return {
    cid: `ticket-qr-${index + 1}@sheltuh.com.au`,
    // Not the code: attachment names show up in mail previews, file lists and downloads, and the code is the ticket.
    filename: `ticket-${index + 1}-qr.png`,
    px: TICKET_QR_MODULES * QR_DISPLAY_PX_PER_MODULE,
    alt: ticketQrAlt(code),
    code,
  };
}

/** The QR's inline PNG attachment. */
export function qrImage(qr: TicketQr): InlineImage[] {
  const image = ticketQrPng(qr.code);
  return image ? [{ cid: qr.cid, contentType: "image/png", content: image.png, filename: qr.filename }] : [];
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
 * built): the date and time refunds close, in the event's zone like the rest
 * of the email, or that they have (lib/refund-policy.ts, refundTermsLine).
 */
export function ticketEmailRefundPolicy(
  order: Pick<OrderRecord, "totalCents">,
  event: EventRecord,
  now: Date = new Date(),
): string | null {
  if (order.totalCents <= 0 || event.status !== "published" || event.ticketingMode === "external") return null;
  return refundTermsLine(event.refundPolicy ?? DEFAULT_REFUND_POLICY, event.refundDays, event.startsAt, {
    timeZone: zoneOf(event),
    now,
  });
}

/**
 * The order summary's lines: "{quantity} × {ticket type}" and what the buyer
 * paid for them, all in (lib/fees.ts's calculateOrderSummary, the function
 * checkout prices with). The amounts are left out (null) unless they add up
 * exactly to the total less any Support Sheltüh: the email never prints
 * numbers that disagree with its total.
 */
export function ticketEmailLineItems(order: Pick<OrderRecord, "lineItems" | "totalCents" | "supportCents">): { label: string; cents: number | null }[] {
  const lines = (order.lineItems ?? []).map((line) => ({
    label: `${line.quantity} × ${line.ticketTypeName}`,
    cents: calculateOrderSummary(line.unitPriceCents, line.quantity, line.feePolicy).totalCents,
  }));
  const support = order.supportCents && order.supportCents > 0 ? order.supportCents : 0;
  const adds = lines.reduce((sum, line) => sum + line.cents, 0) === order.totalCents - support;
  return lines.map((line) => ({ label: line.label, cents: adds ? line.cents : null }));
}

// --- HTML pieces (desktop values inline; the phone's in classes, lib/server/email-ticket-layout.ts) ---

const C = TICKET_EMAIL_COLOURS;

/** A text style: family, size / line height, weight, colour, and anything extra. */
const type = (family: "sans" | "mono", size: number, line: number, weight: number, colour: string, extra = "") =>
  `font-family:${family === "sans" ? SANS : MONO};font-size:${size}px;line-height:${line}px;font-weight:${weight};color:${colour}${extra ? `;${extra}` : ""}`;

/** A paragraph with no margin. `html` is trusted markup: escape anything dynamic first. */
const p = (html: string, style: string, cls = "") => `<p${cls ? ` class="${cls}"` : ""} style="margin:0;${style}">${html}</p>`;

const TABLE = `role="presentation" cellpadding="0" cellspacing="0" border="0"`;
const FULL = `${TABLE} width="100%"`;
const anchor = (href: string, label: string, style = "", extra = "") =>
  `<a href="${escapeHtml(href)}"${extra} style="color:${C.ink};text-decoration:underline;text-underline-offset:2px${style ? `;${style}` : ""}">${label}</a>`;

/** A decorative hosted image (alt="") at its shown size. */
const deco = (src: string, width: number, height: number, extra = "", cls = "") =>
  `<img${cls ? ` class="${cls}"` : ""} src="${escapeHtml(src)}" width="${width}" height="${height}" alt="" style="display:block;border:0;width:${width}px;height:${height}px${extra ? `;${extra}` : ""}">`;

/** What every card of a listed event shows about it (none for an event that isn't listed). */
export interface CardEvent {
  title: string;
  imageUrl: string | null;
  /** The photo's subject, as CSS `object-position` ("40% 25%"), where the client crops to 2:1. */
  imageFocus: string | null;
  venueLine: string;
  date: string;
  time: string;
}

export interface CardInput {
  siteUrl: string;
  title: string;
  /** Null when the event isn't listed: no image, venue line, DATE or TIME. */
  event: CardEvent | null;
  code: string;
  typeName: string;
  seat?: TicketSeat;
  qr: TicketQr | null;
  index: number;
  total: number;
}

/** A stub column: its label (Plex Mono, tracked) over its value. */
function stubCell(label: string, value: string, widthPx?: number, cls = ""): string {
  const width = widthPx ? ` width="${widthPx}"` : "";
  return (
    `<td${cls ? ` class="${cls}"` : ""}${width} valign="top" style="${widthPx ? `width:${widthPx}px;` : ""}padding:0 8px 0 0">` +
    p(label, type("mono", 11, 12, 400, C.muted, "letter-spacing:0.08em;text-transform:uppercase")) +
    p(escapeHtml(value), type("sans", 17, 24, 500, C.ink, "padding-top:5px;overflow-wrap:break-word;word-wrap:break-word"), "sv") +
    `</td>`
  );
}

/**
 * One ticket card (docs/design/ticket-email.md §5.1): an 8px Signal Orange
 * frame (a cell's bgcolor, so Outlook draws it), a white inside with the
 * corner stripes and "ADMIT ONE · SHELTÜH", the event's image (2:1 where the
 * client can crop, its own proportions elsewhere), the title, the venue line,
 * the perforation (a notch each side of a 2px dashed line), DATE / TIME /
 * TICKET, the seat, the QR (its white quiet zone is the space round it), the
 * backup code and "Show this at the door · ticket n of N".
 */
export function ticketCard(card: CardInput): string {
  const { siteUrl, event, qr } = card;
  const side = (top: number, cls = "") => `class="tx${cls ? ` ${cls}` : ""}" style="padding:${top}px 24px 0 24px"`;
  const stripes =
    deco(ticketAssetUrl(siteUrl, TICKET_EMAIL_ASSETS.stripesDesktop), 112, 14, "", "sd") +
    `<!--[if !mso]><!--><div class="sm" style="display:none;max-height:0;overflow:hidden;mso-hide:all">${deco(ticketAssetUrl(siteUrl, TICKET_EMAIL_ASSETS.stripesPhone), 72, 14)}</div><!--<![endif]-->`;
  const header =
    `<tr><td ${side(17)}><table ${FULL}><tr>` +
    `<td align="left" valign="middle" style="font-size:0;line-height:0">${stripes}</td>` +
    `<td align="right" valign="middle" style="${type("mono", 11, 12, 500, C.ink, "letter-spacing:0.08em;white-space:nowrap")}">ADMIT ONE &middot; SHELT&Uuml;H</td>` +
    `</tr></table></td></tr>`;
  const image = event?.imageUrl
    ? `<tr><td ${side(16)}><div class="ei" style="max-height:232px;overflow:hidden;border-radius:4px"><img src="${escapeHtml(event.imageUrl)}" width="${CARD_CONTENT_WIDTH}" alt="${escapeHtml(`Event image for ${card.title}`)}" style="display:block;border:0;width:100%;max-width:${CARD_CONTENT_WIDTH}px;height:auto;aspect-ratio:2/1;object-fit:cover;${event.imageFocus ? `object-position:${event.imageFocus};` : ""}border-radius:4px;${type("sans", 14, 20, 400, C.muted)}"></div></td></tr>`
    : "";
  const title = `<tr><td align="center" ${side(event?.imageUrl ? 27 : 24, event?.imageUrl ? "g25" : "")}>${p(escapeHtml(card.title), type("sans", 32, 38, 700, C.ink, "overflow-wrap:break-word;word-wrap:break-word"), "tt")}</td></tr>`;
  const venue = event?.venueLine
    ? `<tr><td align="center" ${side(10, "gv")}>${p(escapeHtml(event.venueLine), type("mono", 11, 16, 500, C.signalText, "letter-spacing:0.12em;text-transform:uppercase;overflow-wrap:break-word"), "tv")}</td></tr>`
    : "";
  const notch = (src: string) => `<td width="12" valign="middle" style="width:12px;font-size:0;line-height:0">${deco(ticketAssetUrl(siteUrl, src), 12, 24)}</td>`;
  const perforation =
    `<tr><td class="gp" style="padding:22px 0 0 0"><table ${FULL}><tr>` +
    notch(TICKET_EMAIL_ASSETS.notchLeft) +
    `<td class="pf" valign="middle" style="padding:0 12px"><div style="border-top:1.5px dashed ${C.ink};height:0;font-size:0;line-height:0">&nbsp;</div></td>` +
    notch(TICKET_EMAIL_ASSETS.notchRight) +
    `</tr></table></td></tr>`;
  const columns = [
    ...(event ? [["Date", event.date], ["Time", event.time]] : []),
    ...(card.typeName ? [["Ticket", card.typeName]] : []),
  ];
  const stub = columns.length
    ? `<tr><td ${side(20, "g16")}><table ${FULL}><tr>` +
      // As drawn: DATE and TIME 160px apart (152 + 8; 100 on a phone), TICKET the rest.
      columns.map(([label, value], i) => (i < columns.length - 1 ? stubCell(label, value, 152, "sc") : stubCell(label, value))).join("") +
      `</tr></table></td></tr>`
    : "";
  const seat = card.seat
    ? `<tr><td ${side(16)}><table ${FULL}><tr>${stubCell("Seat", formatSeatLine(card.seat))}</tr></table></td></tr>`
    : "";
  const code = qr
    ? `<tr><td align="center" style="padding:0;font-size:0;line-height:0"><img class="qr" src="cid:${escapeHtml(qr.cid)}" width="${qr.px}" height="${qr.px}" alt="${escapeHtml(qr.alt)}" style="display:block;border:0;width:${qr.px}px;max-width:100%;height:auto;image-rendering:pixelated;-ms-interpolation-mode:nearest-neighbor;background-color:${C.white};${type("sans", 13, 18, 400, C.ink)}"></td></tr>` +
      `<tr><td align="center" ${side(0)}>${p(escapeHtml(card.code), type("mono", 18, 24, 600, C.ink, "letter-spacing:0.15em;word-break:break-all"), "cd")}</td></tr>`
    : `<tr><td align="center" ${side(28)}>${p("Entry code", type("mono", 10, 12, 400, C.muted, "letter-spacing:0.1em;text-transform:uppercase"))}${p(escapeHtml(card.code), type("mono", 24, 32, 600, C.ink, "letter-spacing:0.15em;padding-top:4px;word-break:break-all"))}</td></tr>`;
  const note = `<tr><td align="center" class="tx" style="padding:8px 24px 24px 24px">${p(`Show this at the door &middot; ticket ${card.index + 1} of ${card.total}`, type("sans", 13, 16, 400, C.muted))}</td></tr>`;
  return (
    `<table ${FULL} bgcolor="${C.signal}" class="ticket" style="background-color:${C.signal};border-radius:15px;border-collapse:separate"><tr><td style="padding:12px">` +
    `<table ${FULL} bgcolor="${C.white}" style="background-color:${C.white};border-radius:7px;border-collapse:separate">\n` +
    [header, image, title, venue, perforation, stub, seat, code, note].filter(Boolean).join("\n") +
    `\n</table></td></tr></table>`
  );
}

/**
 * A ticket's wallet badges, under its card: the vendors' official artwork
 * (TICKET_EMAIL_WALLET_BADGES, hosted PNGs of their SVGs), Apple's then
 * Google's, both 174px wide at their own proportions (Google's 48 tall,
 * Apple's 55; both 166 wide on a phone), centred on each other with a 12px
 * gap (two equal halves, 8px apart, on a phone). No colour behind
 * them (their corners are transparent), nothing over them, no effects. The
 * alt text is the vendor's wording, shown in black with images off. Their
 * links are ticketWalletLinks'. With `deviceNote` (the last card's row) and
 * Apple's on, Apple's note follows: how to add the pass from a device
 * without Wallet (Apple's badge rules).
 */
function walletButtons(siteUrl: string, links: WalletLink[], index: number, total: number, deviceNote: boolean): string {
  if (links.length === 0) return "";
  const cell = (l: WalletLink) => {
    const badge = TICKET_EMAIL_WALLET_BADGES[l.provider];
    const name = total > 1 ? `${l.label}: ticket ${index + 1} of ${total}` : l.label;
    return (
      `<td class="wh" align="center" valign="middle">` +
      `<a class="wa" href="${escapeHtml(l.href)}"${total > 1 ? ` aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}"` : ""} style="display:inline-block;text-decoration:none">` +
      `<img class="wb" src="${escapeHtml(ticketAssetUrl(siteUrl, badge.x2))}" srcset="${escapeHtml(ticketAssetUrl(siteUrl, badge.x3))} 3x" width="${badge.width}" height="${badge.height}" alt="${escapeHtml(l.label)}" style="display:block;border:0;width:${badge.width}px;max-width:100%;height:auto;${type("sans", 14, 20, 600, C.ink, "text-align:center")}">` +
      `</a></td>`
    );
  };
  const cells = links.map(cell);
  if (cells.length === 2) {
    cells[0] = cells[0].replace('<td class="wh" align="center" valign="middle">', '<td class="wh bl" align="center" valign="middle" style="padding-right:6px">');
    cells[1] = cells[1].replace('<td class="wh" align="center" valign="middle">', '<td class="wh br" align="center" valign="middle" style="padding-left:6px">');
  }
  const row = `<table ${TABLE} align="center" class="wt"><tr>${cells.join("")}</tr></table>`;
  if (!deviceNote || !links.some((l) => l.provider === "apple")) return row;
  return row + p(escapeHtml(appleWalletDeviceNote("email", 1)), type("sans", 13, 16, 400, C.muted, "text-align:center;padding-top:12px"));
}

/** Calendar links for the When row: Google, Apple (the event's .ics) and Outlook, each null when it can't be built. */
export function ticketCalendarLinks(event: EventRecord, siteUrl: string): { google: string | null; apple: string | null; outlook: string | null } {
  if (event.status !== "published" || !event.slug) return { google: null, apple: null, outlook: null };
  const site = siteUrl.replace(/\/+$/, "");
  const url = eventPublicLink(site, event.slug);
  const entry: CalendarEvent = {
    id: event.eventId,
    slug: event.slug,
    title: event.title,
    description: event.description ?? "",
    venueName: event.venueName ?? "",
    venueAddress: event.venueAddress ?? "",
    startsAt: event.startsAt,
    endsAt: event.endsAt,
  };
  return {
    google: googleCalendarUrl(entry, url),
    apple: `${site}${eventCalendarPath(event.slug)}`,
    outlook: outlookCalendarUrl(entry, url),
  };
}


/**
 * The order summary's amounts, as the design itemises them: each line at its
 * ticket price ("1 × Second release A$23.00") and the booking fee on its own
 * row, when those add up exactly to the order's subtotal and total; otherwise
 * each line's all-inclusive amount (ticketEmailLineItems) and no fee row. The
 * email never prints numbers that disagree with its total.
 */
export function ticketEmailSummaryLines(
  order: Pick<OrderRecord, "lineItems" | "totalCents" | "supportCents" | "subtotalCents" | "buyerFeeCents">,
): { lines: { label: string; cents: number | null }[]; bookingFeeCents: number | null } {
  const items = order.lineItems ?? [];
  const support = order.supportCents && order.supportCents > 0 ? order.supportCents : 0;
  const face = items.map((l) => ({ label: `${l.quantity} × ${l.ticketTypeName}`, cents: l.unitPriceCents * l.quantity }));
  const fee = Number.isInteger(order.buyerFeeCents) && order.buyerFeeCents >= 0 ? order.buyerFeeCents : null;
  const faceTotal = face.reduce((sum, l) => sum + l.cents, 0);
  if (items.length > 0 && fee !== null && faceTotal === order.subtotalCents && faceTotal + fee + support === order.totalCents) {
    return { lines: face, bookingFeeCents: fee > 0 ? fee : null };
  }
  return { lines: ticketEmailLineItems(order), bookingFeeCents: null };
}

/** "12 Nov 2026, 9:41 pm": when the order was placed, in the event's zone. */
export function ticketOrderDate(iso: string | undefined, where: EventZone = {}): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  const day = cachedDateTimeFormat("en-AU", { timeZone: zoneOf(where), day: "numeric", month: "short", year: "numeric" });
  return `${day.format(new Date(iso))}, ${time(iso, where)}`;
}

/**
 * The event as the 1120 emails show it: the compact Ticket card (kitTicketCard)
 * with "Sat 14 Nov · 5–9 pm", the title, the venue and the event's image (on
 * an https site). Organiser-supplied text is cleaned with subjectLine. `href`
 * links the title (the event's page).
 */
export function emailEventCard(event: EventRecord, siteUrl: string, href?: string): string {
  const title = subjectLine(event.title);
  return kitTicketCard({
    dateLine: `${formatEventDateShort(event.startsAt, zoneOf(event))} · ${formatStubTime(event.startsAt, event.endsAt, event)}`,
    title,
    venue: subjectLine(event.venueName ?? ""),
    imageUrl: eventImageEmailUrl(siteUrl, event.imageUrl),
    ...(href ? { href } : {}),
  });
}

/** The event card's lines as plain text: the title, "Sat 14 Nov · 5–9 pm", the venue. */
export function emailEventCardText(event: EventRecord): string[] {
  const venue = subjectLine(event.venueName ?? "");
  return [
    subjectLine(event.title),
    `${formatEventDateShort(event.startsAt, zoneOf(event))} · ${formatStubTime(event.startsAt, event.endsAt, event)}`,
    ...(venue ? [venue] : []),
  ];
}

/** The footer's reason line on the ticket email. */
export const TICKET_EMAIL_REASON = "You’re getting this email because you bought a ticket on Sheltüh.";
/** …and on a free order's (Latte's "Free ticket order" frame). */
export const TICKET_EMAIL_FREE_REASON = "You’re getting this email because you got a free ticket on Sheltüh.";

// --- The email ---

/** The line under the other tickets' rows (Latte's 2-ticket frame): their QR codes are on the ticket page. */
export const OTHER_TICKETS_NOTE = "Each ticket has its own QR code. Swipe between them in your ticket.";

/**
 * The sent email: one 600px-max column on the shared layout
 * (lib/server/email-kit.ts), with a plain-text alternative. `now` (when it's
 * built) dates the refund policy (ticketEmailRefundPolicy); `wallet` says
 * which wallets' passes are on, for the first ticket's wallet buttons
 * (ticketWalletLinks; none by default). `extras.buyerName`: the name the
 * buyer gave at checkout (orders.buyer_name), shown on the other tickets'
 * rows of an order with several; none when absent.
 */
export function buildTicketEmail(
  order: OrderRecord,
  event: EventRecord,
  siteUrl: string,
  now: Date = new Date(),
  wallet: WalletAvailability = NO_WALLET,
  extras: { buyerName?: string | null } = {},
): EmailMessage {
  const link = ticketPageLink(siteUrl, order.orderId);
  const total = order.tickets.length;
  const one = total === 1;
  // /checkout/success lists every ticket code, so the button can say "tickets".
  const viewLabel = one ? "View your ticket" : "View your tickets";
  // Only a published event's details go out (the outbox passes the live event on every attempt and resend).
  const listed = event.status === "published";
  const zoneOfEvent: EventZone = event;
  const when = listed ? ticketEmailWhen(event.startsAt, event.endsAt, zoneOfEvent) : null;
  const venueName = listed ? (event.venueName?.trim() ?? "") : "";
  const address = listed ? ticketAddressLine(event) : "";
  const directions = listed ? ticketDirectionsLink(event) : null;
  const imageUrl = listed ? eventImageEmailUrl(siteUrl, event.imageUrl) : null;
  const reference = orderReference(order.orderId);
  const free = order.totalCents === 0;
  // Support Sheltüh the buyer added (paid orders only): its own line above the total, which includes it.
  const support = !free && order.supportCents && order.supportCents > 0 ? order.supportCents : 0;
  const includes = support ? `incl. booking fees and ${SUPPORT_LABEL}` : "incl. booking fees";
  const refunds = ticketEmailRefundPolicy(order, event, now);
  const walletLinks = (i: number) => ticketWalletLinks(order, event, siteUrl, wallet, i);
  // Only a published event is shared and linked: its public page exists.
  const eventLink = listed && event.slug ? eventPublicLink(siteUrl, event.slug) : null;
  const calendar = listed ? ticketCalendarLinks(event, siteUrl) : { google: null, apple: null, outlook: null };
  const share = when && eventLink ? [...tellAFriendLinks(event.title, when.date, eventLink), { label: "Share page", href: eventLink }] : null;
  const host = listed && event.organiserId ? subjectLine(event.organiserName ?? "") : "";
  const hostLink = host ? organiserPageLink(siteUrl, event.organiserId) : null;
  const typeName = (t: IssuedTicket) => (t.ticketTypeName ? ticketNameWithGroup(t.ticketTypeName, t.group) : "");
  const shortDate = listed ? formatEventDateShort(event.startsAt, zoneOf(event)) : "";
  const cardEvent: CardEvent | null = listed
    ? {
        title: event.title,
        imageUrl,
        imageFocus: event.imageFocus && Number.isFinite(event.imageFocus.x) && Number.isFinite(event.imageFocus.y) ? `${Number(event.imageFocus.x)}% ${Number(event.imageFocus.y)}%` : null,
        venueLine: ticketVenueLine(event),
        date: shortDate,
        time: formatStubTime(event.startsAt, event.endsAt, zoneOfEvent),
      }
    : null;
  const { lines: summaryLines, bookingFeeCents } = ticketEmailSummaryLines(order);
  const orderDate = ticketOrderDate(order.createdAt, zoneOfEvent);
  const amount = (cents: number) => formatAudExact(cents);
  const yours = one ? "Here’s your ticket." : `Here are your ${total} tickets.`;
  const headline = free ? `You’re in. ${yours}` : `Hi, you’re in. ${yours}`;
  const eyebrow = `Order ${reference} · Confirmed`;
  const totalLabel = free ? "Total" : "Total paid";
  // Only when the lines are all-inclusive: the itemised summary shows the booking fee itself.
  const allIn = !free && bookingFeeCents === null;
  const includesNote = includes.replace(/^incl\./, "Incl.");
  const summaryNotes = [
    ...(free ? ["No payment was taken, so there’s no tax invoice for this order."] : []),
    ...(allIn ? [includesNote] : []),
    ...(refunds ? [`${refunds} ${REFUND_ACL_STATEMENT}`, ...(support ? [SUPPORT_REFUND_NOTE] : [])] : []),
  ];

  // Only the first ticket gets the full card, and so the only QR code (Latte's 2-ticket frame, owner decision):
  // the others are a row each, and their codes and QR codes are on the ticket page.
  const firstTicket: IssuedTicket | undefined = order.tickets[0];
  const qr = firstTicket ? ticketQr(firstTicket.ticketCode, 0) : null;
  const others = order.tickets.slice(1);
  const buyerName = subjectLine(extras.buyerName ?? "");
  /** An other ticket's "{name} · {type}" and its seat (the row's short form, or the text's spoken one). */
  const otherLine = (t: IssuedTicket, spoken = false) =>
    [buyerName, typeName(t), t.seat ? (spoken ? speakSeatLine(t.seat) : formatSeatLine(t.seat)) : ""].filter(Boolean).join(" · ");
  const firstType = order.tickets[0] ? typeName(order.tickets[0]) : "";
  const footerInput = { siteUrl, tone: "customer" as const, reason: free ? TICKET_EMAIL_FREE_REASON : TICKET_EMAIL_REASON };

  // --- Plain text ---
  const whereText = [venueName, address].filter(Boolean).join(", ");
  /** The plain text: the first ticket's code (its QR code is in the full email), then a line for each other ticket (no code). */
  const plainText = () => [
    "SHELTÜH",
    "",
    eyebrow,
    headline.replaceAll("’", "'"),
    "",
    event.title,
    ...(cardEvent?.venueLine ? [cardEvent.venueLine] : []),
    ...(cardEvent || (one && firstType)
      ? [[...(cardEvent ? [`Date: ${cardEvent.date}`, `Time: ${cardEvent.time}`] : []), ...(one && firstType ? [`Ticket: ${firstType}`] : [])].join(" · ")]
      : []),
    ...(firstTicket
      ? [
          "",
          `Ticket 1 of ${total}${!one && firstType ? ` · ${firstType}` : ""} — Entry code: ${firstTicket.ticketCode} (show this at the door${qr ? "; the QR code is in the full email" : ""})`,
          ...(firstTicket.seat ? [`Seat: ${speakSeatLine(firstTicket.seat)}`] : []),
          ...walletLinks(0).map((l) => `${l.label}: ${l.href}`),
        ]
      : []),
    ...(others.length
      ? [
          "",
          ...others.map((t, j) => `Ticket ${j + 2} of ${total}${otherLine(t, true) ? ` · ${otherLine(t, true)}` : ""} — View: ${link}`),
          OTHER_TICKETS_NOTE,
        ]
      : []),
    ...(walletLinks(0).some((l) => l.provider === "apple") ? ["", appleWalletDeviceNote("email", 1)] : []),
    "",
    `${viewLabel}: ${link}`,
    `Manage order: ${link}`,
    "(Button not working? Use the links above.)",
    "",
    ...(when
      ? [
          `${when.date}${when.lines.length === 1 ? `, ${when.lines[0]}` : ""}`,
          ...(when.lines.length === 1 ? [] : when.lines),
          ...(calendar.google || calendar.apple || calendar.outlook
            ? [
                `Add to calendar — ${[
                  calendar.google ? `Google: ${calendar.google}` : "",
                  calendar.apple ? `Apple: ${calendar.apple}` : "",
                  calendar.outlook ? `Outlook: ${calendar.outlook}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}`,
              ]
            : []),
          ...(whereText ? [whereText] : []),
          ...(directions ? [`Get directions: ${directions}`] : []),
          ...(eventLink ? [`Event info (line-up, door times and what to bring): ${eventLink}`] : []),
          ...(host && hostLink ? [`Hosted by ${host}. Questions about the event? Ask the organiser: ${hostLink}`] : []),
        ]
      : [EVENT_UNLISTED_TEXT]),
    "",
    "ORDER SUMMARY",
    `Order reference: ${reference}`,
    ...(orderDate ? [`Order date: ${orderDate}`] : []),
    ...summaryLines.map((l) => (l.cents === null ? l.label : `${l.label}: ${amount(l.cents)}`)),
    ...(bookingFeeCents !== null ? [`Booking fee: ${amount(bookingFeeCents)}`] : []),
    ...(support ? [`${SUPPORT_LABEL}: ${amount(support)}`] : []),
    `${totalLabel}: ${amount(order.totalCents)}${allIn ? ` (${includes})` : ""}`,
    ...summaryNotes.filter((note) => !allIn || note !== includesNote),
    ...(when && eventLink && share
      ? [
          "",
          "GOING WITH FRIENDS?",
          inviteText(event.title, when.date, eventLink),
          share.map((l) => `${l.label}: ${l.href}`).join(" · "),
        ]
      : []),
    "",
    kitHelpText("customer"),
    "",
    kitFooterText(footerInput),
  ].join("\n");

  // --- HTML ---

  const card = (t: IssuedTicket, i: number) =>
    ticketCard({ siteUrl, title: event.title, event: cardEvent, code: t.ticketCode, typeName: typeName(t), seat: t.seat, qr: i === 0 ? qr : null, index: i, total });

  /**
   * The other tickets (Latte's 2-ticket frame): a cream row each, "TICKET n of N", the buyer's name and the
   * ticket type, and View (the ticket page: it has no per-ticket address). No code: the page holds them.
   * `rows`: how many get a row (the size budget, below); the rest are one line pointing at the ticket page.
   */
  const otherRows = (rows: number) => {
    if (others.length === 0) return "";
    const row = (t: IssuedTicket, j: number) =>
      `<table ${FULL} bgcolor="${KIT.cream}" style="background-color:${KIT.cream};border-radius:8px;border-collapse:separate"><tr>` +
      `<td valign="middle" style="padding:16px 12px 16px 24px">` +
      p(`TICKET ${j + 2} of ${total}`, type("mono", 12, 16, 500, C.muted, "letter-spacing:0.72px")) +
      (otherLine(t) ? p(escapeHtml(otherLine(t)), type("sans", 16, 24, 600, C.ink, "padding-top:4px;overflow-wrap:break-word;word-wrap:break-word")) : "") +
      `</td><td align="right" valign="middle" style="padding:16px 24px 16px 0;white-space:nowrap">` +
      p(anchor(link, "View", "", ` aria-label="View ticket ${j + 2} of ${total}"`), type("sans", 15, 22, 600, C.ink)) +
      `</td></tr></table>`;
    const shown = others.slice(0, rows);
    const rest = others.length - shown.length;
    return kitStack(
      [
        kitStack(shown.map(row), 8),
        rest > 0
          ? p(
              `${rest === others.length ? `Tickets 2&ndash;${total}` : `Tickets ${rows + 2}&ndash;${total}`} are on ${anchor(link, "your ticket page")}.`,
              type("sans", 15, 22, 400, C.muted),
            )
          : "",
        p(escapeHtml(OTHER_TICKETS_NOTE), type("sans", 15, 22, 400, C.muted)),
      ].filter(Boolean),
      16,
    );
  };

  const calendarLinks = [
    calendar.google ? anchor(calendar.google, "Google", "", ` title="Add to Google Calendar"`) : "",
    calendar.apple ? anchor(calendar.apple, "Apple", "", ` title="Add to Apple Calendar"`) : "",
    calendar.outlook ? anchor(calendar.outlook, "Outlook", "", ` title="Add to Outlook Calendar"`) : "",
  ].filter(Boolean);
  const detailRows: KitDetailRow[] = when
    ? [
        {
          icon: "calendar",
          title: when.date,
          lines: when.lines,
          ...(calendarLinks.length ? { linkHtml: `Add to calendar: ${calendarLinks.join(" &middot; ")}` } : {}),
        },
        ...(venueName || address
          ? [
              {
                icon: "pin" as const,
                title: venueName || address,
                lines: venueName && address ? [address] : [],
                ...(directions ? { linkHtml: anchor(directions, "Get directions&nbsp;&#8599;") } : {}),
              },
            ]
          : []),
        ...(eventLink
          ? [{ icon: "info" as const, title: "Event info", lines: ["Line-up, door times and what to bring"], linkHtml: anchor(eventLink, "View event info") }]
          : []),
        ...(host && hostLink
          ? [
              {
                icon: "info" as const,
                title: `Hosted by ${host}`,
                lines: ["Questions about the event? Ask the organiser."],
                linkHtml: anchor(hostLink, "Contact organiser"),
              },
            ]
          : []),
      ]
    : [];
  const details = when
    ? kitDetails(siteUrl, detailRows)
    : p(
        `This event is no longer listed. Contact ${anchor(`mailto:${SUPPORT_EMAIL}`, escapeHtml(SUPPORT_EMAIL))} if you have questions.`,
        type("sans", 16, 24, 400, C.ink),
      );

  const summary = kitSummary({
    title: "Order summary",
    rows: [
      { label: "Order reference", value: reference, mono: true },
      ...(orderDate ? [{ label: "Order date", value: orderDate }] : []),
      ...summaryLines.map((l) => ({ label: l.label, value: l.cents === null ? "" : amount(l.cents) })),
      ...(bookingFeeCents !== null ? [{ label: "Booking fee", value: amount(bookingFeeCents) }] : []),
      ...(support ? [{ label: SUPPORT_LABEL, value: amount(support) }] : []),
    ],
    total: { label: totalLabel, value: amount(order.totalCents) },
    notes: summaryNotes,
  });

  const preheader = [free ? "Free entry" : "", shortDate, venueName, `Order ${reference}`].filter(Boolean).join(" · ");

  /** The whole page with a row for the first `rows` other tickets (the rest one line). */
  const render = (rows: number) => {
    const body = kitStack([
      kitHeader(),
      kitIntro(eyebrow, headline),
      firstTicket ? card(firstTicket, 0) : "",
      otherRows(rows),
      // As the frames place them: under the card, or under the other tickets' rows. The first ticket's only.
      firstTicket ? walletButtons(siteUrl, walletLinks(0), 0, total, true) : "",
      kitButtons([
        { label: viewLabel, href: link, kind: "primary" },
        { label: "Manage order", href: link, kind: "secondary" },
      ]),
      details,
      summary,
      share ? kitTellAFriend(share) : "",
      kitHelp("customer"),
      kitFooter(footerInput),
    ]);
    return kitPage({ title: `You're in: ${event.title}`, preheader, siteUrl, body, tone: "customer", phoneCss: TICKET_PHONE_RULES });
  };

  // A row for every other ticket, unless that passes the size budget: then as many as fit, the rest one line.
  let rows = others.length;
  let html = render(rows);
  if (Buffer.byteLength(html) > TICKET_EMAIL_HTML_BUDGET) {
    let [low, high] = [0, others.length - 1];
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (Buffer.byteLength(render(mid)) <= TICKET_EMAIL_HTML_BUDGET) low = mid;
      else high = mid - 1;
    }
    rows = low;
    html = render(rows);
  }

  const inlineImages = [ticketWordmarkImage(), ...(qr ? qrImage(qr) : [])];
  return {
    to: order.buyerEmail ?? "",
    subject: subjectLine(free ? `You’re in: ${event.title}` : one ? `Your ticket to ${event.title}` : `Your ${total} tickets to ${event.title}`),
    text: plainText(),
    html,
    inlineImages,
  };
}

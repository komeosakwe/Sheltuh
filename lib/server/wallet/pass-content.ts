import { formatEventDateKey, formatEventDateShort, formatEventDateTimeRange, formatEventTime } from "@/lib/format";
import { formatSeatLine } from "@/lib/seating/format";
import { TICKET_CODE_PATTERN, ticketQrPayload } from "@/lib/ticket-code";
import { cachedDateTimeFormat, PLATFORM_TIME_ZONE, wallClockParts } from "@/lib/time-zones";
import type { TicketSeat } from "../types";

/**
 * What one ticket's wallet pass shows, whichever wallet it's for: built once
 * from the order (as the ticket page reads it) and the event, so the Google
 * and Apple passes can't disagree. No buyer data: not the email address, not
 * the order id (only its short reference, as on the ticket page).
 */
export interface WalletTicket {
  eventId: string;
  /**
   * The event's current title (as the ticket email shows it; the passes are
   * only made while the event is published, so it's the public one). Google's
   * class is shared by every ticket for the event, so it can't be any one
   * order's snapshot.
   */
  eventTitle: string;
  startsAt: string;
  endsAt?: string;
  /** The zone the times are shown in (passTimeZone). */
  timeZone: string;
  venueName?: string;
  /** The street address, when the event has one. */
  venueAddress?: string;
  suburb?: string;
  ticketTypeName: string;
  /** 1-based, in the API's and the email's order (ticket type, then code). */
  ticketNumber: number;
  ticketCount: number;
  seat?: TicketSeat;
  /** The backup code the door can type in. */
  code: string;
  /** What the QR carries: exactly the email's and the ticket page's (`SH1:` + code), or undefined for a code that gets no QR. */
  qrPayload?: string;
  /** The order's short reference ("#7C1F2E0A"), as on the ticket page. */
  orderReference: string;
  /**
   * The pass's id: the ticket's `wallet_serial` (a random uuid, migration
   * 20261109000500_ticket_wallet_serial.sql) as 32 hex characters. Apple's
   * serialNumber and the end of Google's object id, so the same ticket is
   * always the same pass (adding it again replaces it). Random, so it says
   * nothing about the code.
   */
  serial: string;
}

/**
 * The zone an event's times are shown in on its passes. Every event is in
 * Melbourne time today; when events get their own zone, take the event here
 * and return its zone (the one place the passes take it from).
 */
export function passTimeZone(): string {
  return PLATFORM_TIME_ZONE;
}

/** The QR payload for a code, as lib/ticket-qr.ts encodes it: none for a code that isn't a canonical one. */
export function walletQrPayload(code: string): string | undefined {
  return TICKET_CODE_PATTERN.test(code) ? ticketQrPayload(code) : undefined;
}

/** A pass serial: 32 lower-case hex characters (a uuid without its dashes). */
export const WALLET_SERIAL_PATTERN = /^[0-9a-f]{32}$/;

function zoneAbbreviation(iso: string, timeZone: string): string {
  const formatter = cachedDateTimeFormat("en-AU", { timeZone, timeZoneName: "short" });
  return formatter.formatToParts(new Date(iso)).find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * An instant as the venue's local date and time with its UTC offset, to the
 * minute: "2027-03-06T20:00:00+11:00". What Google's EventDateTime asks for
 * (the local time at the venue, with its offset) and Apple's relevantDate
 * takes (W3C date and time with a zone).
 */
export function localIsoWithOffset(iso: string, timeZone: string): string {
  const { date, time } = wallClockParts(iso, timeZone);
  const minute = Math.floor(new Date(iso).getTime() / 60_000) * 60_000;
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = time.split(":").map(Number);
  const offset = Math.round((Date.UTC(y, m - 1, d, h, min) - minute) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${date}T${time}:00${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** "Sat 6 Mar 2027": the start's day, with its year (a pass is often saved months ahead). */
export function passDate(ticket: Pick<WalletTicket, "startsAt" | "timeZone">): string {
  return `${formatEventDateShort(ticket.startsAt, ticket.timeZone)} ${formatEventDateKey(ticket.startsAt, ticket.timeZone).slice(0, 4)}`;
}

/** "8:00 pm AEDT": the start time and its zone. */
export function passStartTime(ticket: Pick<WalletTicket, "startsAt" | "timeZone">): string {
  return `${formatEventTime(ticket.startsAt, ticket.timeZone)} ${zoneAbbreviation(ticket.startsAt, ticket.timeZone)}`.trim();
}

/** "Sat 6 Mar, 8:00 pm – 11:30 pm AEDT", or across days "Fri 5 Mar, 9:00 pm – Sat 6 Mar, 2:00 am AEDT". */
export function passWhen(ticket: Pick<WalletTicket, "startsAt" | "endsAt" | "timeZone">): string {
  const range = formatEventDateTimeRange(ticket.startsAt, ticket.endsAt, ticket.timeZone);
  return `${range} ${zoneAbbreviation(ticket.endsAt ?? ticket.startsAt, ticket.timeZone)}`.trim();
}

/** "Ticket 1 of 3", or "Ticket 1 of 1". */
export function passTicketNumber(ticket: Pick<WalletTicket, "ticketNumber" | "ticketCount">): string {
  return `Ticket ${ticket.ticketNumber} of ${ticket.ticketCount}`;
}

/** "Stalls · Row F · Seat 12", or undefined for general admission. */
export function passSeat(ticket: Pick<WalletTicket, "seat">): string | undefined {
  return ticket.seat ? formatSeatLine(ticket.seat) : undefined;
}

/**
 * "71 Johnston St, Collingwood": the street address and the suburb (left out
 * when the address already names it), or whichever there is.
 */
export function passAddress(ticket: Pick<WalletTicket, "venueAddress" | "suburb">): string | undefined {
  const address = ticket.venueAddress?.trim() ?? "";
  const suburb = ticket.suburb?.trim() ?? "";
  if (address && suburb && address.toLowerCase().includes(suburb.toLowerCase())) return address;
  return [address, suburb].filter(Boolean).join(", ") || undefined;
}

/** "The Tote, 71 Johnston St, Collingwood", or whichever parts there are. */
export function passVenue(ticket: Pick<WalletTicket, "venueName" | "venueAddress" | "suburb">): string | undefined {
  return [ticket.venueName?.trim(), passAddress(ticket)].filter(Boolean).join(", ") || undefined;
}

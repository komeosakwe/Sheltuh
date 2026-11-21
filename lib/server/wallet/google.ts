import { sign } from "node:crypto";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { WALLET_COLOURS, WALLET_ORGANISATION_NAME } from "./brand";
import type { GoogleWalletConfig } from "./config";
import {
  localIsoWithOffset,
  passAddress,
  passDate,
  passSeat,
  passTicketNumber,
  passTicketType,
  passTime,
  passWhen,
  WALLET_SERIAL_PATTERN,
  type WalletTicket,
} from "./pass-content";

/**
 * "Add to Google Wallet": a signed "Save to Google Wallet" JWT carrying one
 * ticket's event ticket class and object inline (no Google API call, no
 * dependency), opened as https://pay.google.com/gp/v/save/{jwt}. Signed
 * RS256 with the service account's private key (node:crypto).
 *
 * One ticket per JWT, not the whole order: the JWT travels in a URL, which
 * should stay short (Google's docs, as remembered, warn against long JWT
 * links; unverified here); one ticket's JWT is about 2.5 KB, so an order's
 * worth (up to 10 seats, or more general admission tickets) could pass what
 * browsers and Google's own front end reliably accept.
 * It also matches the Apple pass, which is one per ticket.
 *
 * Google inserts the class and object the first time a JWT is saved and
 * keeps its copy after that (no updates in v1: the REST API would be needed;
 * docs/architecture.md, "Wallet passes"). So a change to the class here (its
 * images or card rows) reaches only events nobody has saved a pass for yet;
 * an event whose class Google already holds keeps the old one.
 *
 * The card is the designer's 20 Nov 2026 frame (docs/wallet-setup.md, "What
 * the passes look like"): white, the round logo and "Sheltüh", the venue and
 * event names (Google's own header), one row of Date, Time and Ticket, the
 * QR, and the banner at the bottom. Google draws all of it, in its own type
 * and label colour: what's set here is the background, the two images, which
 * fields the rows hold and their labels and values.
 */

const LANGUAGE = "en-AU";

/** The save link's base. */
export const GOOGLE_SAVE_URL_BASE = "https://pay.google.com/gp/v/save/";

/**
 * Public images Google fetches itself (scripts/render-wallet-images.ts). New
 * artwork gets a new file name, never a new image at an old one: the classes
 * Google already holds still point at /wallet/google-logo.png and
 * /wallet/google-hero.png (the look before 21 Nov 2026), which stay in
 * public/wallet/ for them, and Google keeps a copy of what it fetches (for
 * how long is unverified here), so a changed file might not show.
 */
export const GOOGLE_LOGO_PATH = "/wallet/google-logo-v2.png";
export const GOOGLE_HERO_PATH = "/wallet/google-hero-v2.png";

/**
 * The card's rows, in place of Google's default ones (its template override:
 * `classTemplateInfo.cardTemplateOverride`). Each item names one of the
 * object's text modules by id; Google shows the module's header as the label
 * and its body as the value. Row 1 is the frame's Date, Time and Ticket. Row
 * 2 is what tells one of an order's passes from another, which the frame
 * (an order of one, unseated) doesn't show: the seat, or with no seat the
 * ticket's number when the order has more than one. Only those tickets'
 * objects have that module (Google's docs, as remembered, leave out an item
 * whose field is empty; unverified here, as is the override itself:
 * docs/wallet-setup.md has the owner check each kind of ticket on a phone
 * before relying on it).
 */
const CARD_FIELD = { date: "date", time: "time", ticket: "ticket", which: "which" } as const;

/**
 * A row's value is cut to this many characters ("…" last). The row has room
 * for far fewer, so Google cuts a long one itself, and the whole of it is
 * in the object anyway (ticketType, seatInfo: Google's details). Cutting it
 * here keeps the save URL short: without it a long ticket type name would
 * travel twice. One row-2 item, not two, for the same reason.
 */
const CARD_VALUE_MAX = 40;

function cardValue(value: string): string {
  const characters = Array.from(value);
  return characters.length > CARD_VALUE_MAX ? `${characters.slice(0, CARD_VALUE_MAX - 1).join("").trimEnd()}…` : value;
}

const cardItem = (id: string) => ({ firstValue: { fields: [{ fieldPath: `object.textModulesData['${id}']` }] } });

const CARD_TEMPLATE = {
  cardTemplateOverride: {
    cardRowTemplateInfos: [
      {
        threeItems: {
          startItem: cardItem(CARD_FIELD.date),
          middleItem: cardItem(CARD_FIELD.time),
          endItem: cardItem(CARD_FIELD.ticket),
        },
      },
      { oneItem: { item: cardItem(CARD_FIELD.which) } },
    ],
  },
} as const;

/** Google's ids allow only [A-Za-z0-9._-]: anything else is dropped. */
export function googleIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "");
}

export function googleClassId(issuerId: string, eventId: string): string {
  return `${issuerId}.${googleIdPart(`sheltuh-event-${eventId}`)}`;
}

/** `serial`: the ticket's wallet serial (WalletTicket.serial), never anything derived from its code. */
export function googleObjectId(issuerId: string, serial: string): string {
  if (!WALLET_SERIAL_PATTERN.test(serial)) throw new Error("A wallet pass serial must be 32 hex characters.");
  return `${issuerId}.sheltuh-ticket-${serial}`;
}

const localized = (value: string) => ({ defaultValue: { language: LANGUAGE, value } });

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The JWT's claims (exported for tests). `now` is seconds since the epoch. */
export function googleSaveClaims(config: GoogleWalletConfig, ticket: WalletTicket, siteUrl: string, now: number) {
  const origin = new URL(siteUrl).origin;
  const classId = googleClassId(config.issuerId, ticket.eventId);
  const address = passAddress(ticket);
  const venueName = ticket.venueName?.trim();
  const seat = passSeat(ticket);
  // Row 2 (CARD_TEMPLATE): the seat, or the ticket's number when the order has more than one.
  const which = seat
    ? { id: CARD_FIELD.which, header: "Seat", body: cardValue(seat) }
    : ticket.ticketCount > 1
      ? { id: CARD_FIELD.which, header: "Ticket number", body: passTicketNumber(ticket) }
      : undefined;
  const eventTicketClass = {
    id: classId,
    issuerName: WALLET_ORGANISATION_NAME,
    // A class inserted through a JWT starts under review; Google approves it with the issuer's publishing access.
    reviewStatus: "UNDER_REVIEW",
    eventName: localized(ticket.eventTitle),
    ...(venueName || address
      ? { venue: { name: localized(venueName || address || ""), address: localized(address || venueName || "") } }
      : {}),
    dateTime: {
      start: localIsoWithOffset(ticket.startsAt, ticket.timeZone),
      ...(ticket.endsAt ? { end: localIsoWithOffset(ticket.endsAt, ticket.timeZone) } : {}),
    },
    logo: { sourceUri: { uri: `${origin}${GOOGLE_LOGO_PATH}` }, contentDescription: localized(WALLET_ORGANISATION_NAME) },
    heroImage: { sourceUri: { uri: `${origin}${GOOGLE_HERO_PATH}` }, contentDescription: localized(WALLET_ORGANISATION_NAME) },
    hexBackgroundColor: WALLET_COLOURS.white,
    classTemplateInfo: CARD_TEMPLATE,
    homepageUri: { uri: origin, description: WALLET_ORGANISATION_NAME },
    // In the details under the card, with the address and the order reference.
    linksModuleData: { uris: [{ id: "support", uri: `mailto:${SUPPORT_EMAIL}`, description: "Contact support" }] },
  };
  const eventTicketObject = {
    id: googleObjectId(config.issuerId, ticket.serial),
    classId,
    state: "ACTIVE",
    ...(ticket.qrPayload
      ? { barcode: { type: "QR_CODE", value: ticket.qrPayload, alternateText: ticket.code } }
      : {}),
    ticketType: localized(ticket.ticketTypeName || "Ticket"),
    // Shown under Google's own "Ticket number" label: "1 of 3".
    ticketNumber: passTicketNumber(ticket),
    ...(ticket.seat
      ? {
          seatInfo: {
            seat: localized(ticket.seat.seat),
            ...(ticket.seat.row ? { row: localized(ticket.seat.row) } : {}),
            section: localized(ticket.seat.section),
          },
        }
      : {}),
    hexBackgroundColor: WALLET_COLOURS.white,
    textModulesData: [
      // The card's rows (CARD_TEMPLATE), labelled in sentence case as the frame has them.
      { id: CARD_FIELD.date, header: "Date", body: passDate(ticket) },
      { id: CARD_FIELD.time, header: "Time", body: passTime(ticket) },
      { id: CARD_FIELD.ticket, header: "Ticket", body: cardValue(passTicketType(ticket)) },
      ...(which ? [which] : []),
      // The details under the card.
      { id: "when", header: "When", body: passWhen(ticket) },
      ...(ticket.qrPayload ? [] : [{ id: "code", header: "Entry code", body: ticket.code }]),
      { id: "order", header: "Order reference", body: ticket.orderReference },
    ],
  };
  return {
    iss: config.serviceAccountEmail,
    aud: "google",
    typ: "savetowallet",
    iat: now,
    origins: [origin],
    payload: { eventTicketClasses: [eventTicketClass], eventTicketObjects: [eventTicketObject] },
  };
}

/** The signed JWT (RS256). */
export function buildGoogleSaveJwt(config: GoogleWalletConfig, ticket: WalletTicket, siteUrl: string, now = Math.floor(Date.now() / 1000)): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify(googleSaveClaims(config, ticket, siteUrl, now)));
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${claims}`), config.privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

export function googleSaveUrl(jwt: string): string {
  return `${GOOGLE_SAVE_URL_BASE}${jwt}`;
}

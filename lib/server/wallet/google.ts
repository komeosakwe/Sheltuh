import { sign } from "node:crypto";
import { WALLET_COLOURS, WALLET_ORGANISATION_NAME } from "./brand";
import type { GoogleWalletConfig } from "./config";
import {
  localIsoWithOffset,
  passAddress,
  passWhen,
  walletSerial,
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
 * docs/architecture.md, "Wallet passes").
 */

const LANGUAGE = "en-AU";

/** The save link's base. */
export const GOOGLE_SAVE_URL_BASE = "https://pay.google.com/gp/v/save/";

/** Public images Google fetches itself (scripts/render-wallet-images.ts). */
export const GOOGLE_LOGO_PATH = "/wallet/google-logo.png";
export const GOOGLE_HERO_PATH = "/wallet/google-hero.png";

/** Google's ids allow only [A-Za-z0-9._-]: anything else is dropped. */
export function googleIdPart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "");
}

export function googleClassId(issuerId: string, eventId: string): string {
  return `${issuerId}.${googleIdPart(`sheltuh-event-${eventId}`)}`;
}

export function googleObjectId(issuerId: string, code: string): string {
  return `${issuerId}.sheltuh-ticket-${walletSerial(code)}`;
}

const localized = (value: string) => ({ defaultValue: { language: LANGUAGE, value } });

const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** The JWT's claims (exported for tests). `now` is seconds since the epoch. */
export function googleSaveClaims(config: GoogleWalletConfig, ticket: WalletTicket, siteUrl: string, now: number) {
  const origin = new URL(siteUrl).origin;
  const classId = googleClassId(config.issuerId, ticket.eventId);
  const address = passAddress(ticket);
  const venueName = ticket.venueName?.trim();
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
    hexBackgroundColor: WALLET_COLOURS.ivory,
    homepageUri: { uri: origin, description: WALLET_ORGANISATION_NAME },
  };
  const eventTicketObject = {
    id: googleObjectId(config.issuerId, ticket.code),
    classId,
    state: "ACTIVE",
    ...(ticket.qrPayload
      ? { barcode: { type: "QR_CODE", value: ticket.qrPayload, alternateText: ticket.code } }
      : {}),
    ticketType: localized(ticket.ticketTypeName || "Ticket"),
    // Shown under Google's own "Ticket number" label: "1 of 3".
    ticketNumber: `${ticket.ticketNumber} of ${ticket.ticketCount}`,
    ...(ticket.seat
      ? {
          seatInfo: {
            seat: localized(ticket.seat.seat),
            ...(ticket.seat.row ? { row: localized(ticket.seat.row) } : {}),
            section: localized(ticket.seat.section),
          },
        }
      : {}),
    hexBackgroundColor: WALLET_COLOURS.ivory,
    textModulesData: [
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

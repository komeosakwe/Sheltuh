/**
 * Ticket codes, shared by the server (issuing, check-in) and the browser
 * (manual entry, the scanner, the QR on the ticket page).
 *
 * A code is 8 characters from a 32-letter alphabet without the easily
 * confused 0/O and 1/I, split 4-4 by a hyphen: `7KQM-2HXD`. That's 40 random
 * bits (lib/server/ticket-issuance.ts). The QR on a ticket encodes the same
 * code with a version prefix: `SH1:7KQM-2HXD`.
 */

/** No 0/O/1/I. 32 letters, so a random byte % 32 has no bias. */
export const TICKET_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A canonical code: upper case, hyphen after the fourth character. */
export const TICKET_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

/** What a ticket's QR code carries before the code. */
export const TICKET_QR_PREFIX = "SH1:";

/**
 * Anything longer than this can't be a code, with or without the prefix and
 * surrounding whitespace; it's refused before any further work.
 */
const MAX_RAW_LENGTH = 64;

/**
 * The canonical code from a scan or a typed entry, or null if it isn't one.
 * Accepts `XXXX-XXXX` or `SH1:XXXX-XXXX`, in any case, with surrounding
 * whitespace. Never throws.
 */
export function parseTicketCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_RAW_LENGTH) return null;
  let value = raw.trim().toUpperCase();
  if (value.startsWith(TICKET_QR_PREFIX)) value = value.slice(TICKET_QR_PREFIX.length);
  return TICKET_CODE_PATTERN.test(value) ? value : null;
}

/** The text a ticket's QR code encodes. */
export function ticketQrPayload(code: string): string {
  return `${TICKET_QR_PREFIX}${code}`;
}

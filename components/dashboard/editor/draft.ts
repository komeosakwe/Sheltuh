import type { VenueResolution } from "@/components/dashboard/VenueSuburbField";
import type { TicketTypeInput } from "@/lib/api/types";
import { MAX_REFUND_DAYS, MIN_REFUND_DAYS, isValidRefundDays, type RefundPolicy } from "@/lib/refund-policy";
import { MIN_PAID_TICKET_CENTS } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { checkExternalTicketUrl, MAX_EXTERNAL_PRICE_FROM_CENTS, type TicketingMode } from "@/lib/ticketing";

/** What a platform-managed organiser's paid ticket is refused with (and the admin note says). */
export const PLATFORM_FREE_ONLY = "A platform-managed organiser can only offer free tickets here, or link to another site.";

/** Publishing needs the venue's confirmed pin: said by the venue and by the buttons. */
export const LOCATION_REQUIRED_TEXT = "Add the venue location and confirm the pin first.";

/** The longest ticket description the editor takes. The API has no limit of its own (it trims and stores the text). */
export const MAX_TICKET_DESCRIPTION_LENGTH = 300;

/** What a "Price from" that isn't a price is refused with (the API's own wording, lib/server/ticketing-input.ts). */
export const EXTERNAL_PRICE_FROM_MESSAGE = "Enter a price between $0.01 and $10,000, or leave it blank.";

/**
 * The "Price from (A$)" field as typed, in whole cents: null while blank, NaN
 * when it isn't a price (not a number, below 1 cent, above A$10,000, or with
 * fractions of a cent). Pure.
 */
export function parseExternalPriceFrom(text: string): number | null {
  const typed = text.trim();
  if (!typed) return null;
  const dollars = Number(typed);
  if (!Number.isFinite(dollars)) return Number.NaN;
  const cents = Math.round(dollars * 100);
  if (Math.abs(dollars * 100 - cents) > 1e-6 || cents < 1 || cents > MAX_EXTERNAL_PRICE_FROM_CENTS) return Number.NaN;
  return cents;
}

/** What the form's checks look at: the same values `buildInput` reads when saving. */
export interface DraftCheckInput {
  title: string;
  description: string;
  venueName: string;
  venueAddress: string;
  /** The suburb as it resolves (useVenuePlace's resolveForSave), or as it stands on screen. */
  place: VenueResolution;
  start: { date: string; time: string };
  end: { date: string; time: string };
  /** An admin creating an event who hasn't chosen its organiser yet. */
  organiserMissing: boolean;
  isAdmin: boolean;
  platformManaged: boolean;
  ticketingMode: TicketingMode;
  externalTicketUrl: string;
  /** External events only: the "Price from (A$)" as typed, and the free flag that makes it moot. */
  externalPrice?: string;
  externalFree?: boolean;
  ticketTypes: readonly TicketTypeInput[];
  refundPolicy: RefundPolicy;
  /** The days as typed, as a number (NaN when blank or not a number). */
  refundDays: number;
}

/**
 * The form's own errors, by field key (`title`, `ticket-0-price`, `refundDays`, ...), or none when it
 * would be sent. The one definition `buildInput` saves with, and the step markers and the "Before you
 * publish" list read: they can't disagree. Pure; shows and blocks nothing by itself.
 */
export function draftErrors(input: DraftCheckInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.title.trim()) errors.title = "Enter an event title.";
  if (!input.description.trim()) errors.description = "Enter a description.";
  if (!input.venueName.trim()) errors.venueName = "Enter a venue name.";
  if (!input.venueAddress.trim()) errors.venueAddress = "Enter a venue address.";
  const { place } = input;
  if (place.kind === "empty") errors.suburb = "Enter a suburb or town.";
  else if (place.kind === "unknown" || place.kind === "unavailable") errors.suburb = place.message;
  if (!input.start.date || !input.start.time) errors.start = "Enter a start date and time.";
  if (!input.end.date || !input.end.time) errors.end = "Enter an end date and time.";
  if (input.organiserMissing) errors.organiserId = "Choose an organiser.";
  if (input.ticketingMode === "external") {
    // Only an admin edits the link here; an organiser's external event keeps its stored one.
    if (input.isAdmin) {
      const url = input.externalTicketUrl.trim();
      const checked = checkExternalTicketUrl(url);
      if (!url) errors.externalTicketUrl = "Enter the address of the page where tickets are sold.";
      else if (!checked.ok) errors.externalTicketUrl = checked.message;
    }
    if (!input.externalFree && Number.isNaN(parseExternalPriceFrom(input.externalPrice ?? ""))) {
      errors.externalPriceFromCents = EXTERNAL_PRICE_FROM_MESSAGE;
    }
  } else {
    if (input.ticketTypes.length === 0) errors.ticketTypes = "Add at least one ticket type.";
    input.ticketTypes.forEach((t, i) => {
      if (!t.name.trim()) errors[`ticket-${i}-name`] = "Enter a ticket name.";
      if (!Number.isInteger(t.priceCents) || t.priceCents < 0) errors[`ticket-${i}-price`] = "Enter a valid price.";
      else if (t.priceCents > 0 && input.platformManaged) errors[`ticket-${i}-price`] = PLATFORM_FREE_ONLY;
      else if (t.priceCents > 0 && t.priceCents < MIN_PAID_TICKET_CENTS)
        errors[`ticket-${i}-price`] = `A paid ticket must cost at least ${formatAud(MIN_PAID_TICKET_CENTS)} (or make it free).`;
      if (!Number.isInteger(t.quantityAvailable) || t.quantityAvailable < 1)
        errors[`ticket-${i}-qty`] = "Enter how many are available.";
    });
    if (input.refundPolicy === "days_before" && !isValidRefundDays(input.refundDays))
      errors.refundDays = `Enter a whole number of days from ${MIN_REFUND_DAYS} to ${MAX_REFUND_DAYS}.`;
  }
  return errors;
}

/** A ticket type as it's sent: its description trimmed, and left out when blank (the API stores none then). */
export function cleanTicketType(ticket: TicketTypeInput): TicketTypeInput {
  const { description, ...rest } = ticket;
  const text = description?.trim();
  return text ? { ...rest, description: text } : rest;
}

/** Whether the form, as it stands, has no error in the step's fields (never blocks anything; a marker only). */
export function stepComplete(step: 1 | 2, errors: Record<string, string>, venueHasPin: boolean): boolean {
  const keys = Object.keys(errors);
  if (step === 1) {
    return venueHasPin && !keys.some((key) => stepOfErrorKey(key) === 1);
  }
  return !keys.some((key) => stepOfErrorKey(key) === 2);
}

/** The editor's three views of the one form. */
export type EditorStep = 1 | 2 | 3;

export const EDITOR_STEPS: readonly { step: EditorStep; label: string; description: string }[] = [
  { step: 1, label: "Event page", description: "Photo, details, venue and date" },
  { step: 2, label: "Tickets", description: "Prices, seating and refunds" },
  { step: 3, label: "Publish", description: "Check it and go live" },
];

/** The step a field's error key belongs to (`title`, `ticket-1-qty`, `refundDays`, `reason`, ...); step 1 for the rest. */
export function stepOfErrorKey(key: string): EditorStep {
  if (key === "reason") return 3;
  if (
    key.startsWith("ticket") ||
    key === "externalTicketUrl" ||
    key === "externalPriceFromCents" ||
    key === "refundPolicy" ||
    key === "refundDays" ||
    key === "seating"
  )
    return 2;
  return 1;
}

/** The step a control id belongs to (see `stepOfErrorKey`; ids are the controls the editor focuses). */
export function stepOfControlId(id: string): EditorStep {
  if (id === "admin-reason" || id.startsWith("publish")) return 3;
  if (
    id.startsWith("ticket-") ||
    id === "add-ticket-type" ||
    id === "externalTicketUrl" ||
    id === "externalPriceFromCents" ||
    id === "ticketingMode" ||
    id.startsWith("refund") ||
    id.startsWith("seating")
  )
    return 2;
  return 1;
}

/** What each error key is called in the error summary ("Title: Enter an event title."). */
export function errorFieldLabel(key: string): string {
  const ticket = /^ticket-(\d+)-(name|price|qty)$/.exec(key);
  if (ticket) {
    const field = { name: "name", price: "price", qty: "quantity" }[ticket[2]];
    return `Ticket ${Number(ticket[1]) + 1} ${field}`;
  }
  switch (key) {
    case "title":
      return "Title";
    case "description":
      return "Description";
    case "venueName":
      return "Venue name";
    case "venueAddress":
      return "Venue address";
    case "suburb":
    case "state":
    case "timeZone":
      return "Suburb";
    case "location":
      return "Venue location";
    case "start":
      return "Start";
    case "end":
      return "End";
    case "externalTicketUrl":
      return "Ticket page address";
    case "externalPriceFromCents":
      return "Price from";
    case "ticketTypes":
      return "Ticket types";
    case "refundPolicy":
    case "refundDays":
      return "Refund policy";
    case "organiserId":
      return "Organiser";
    case "image":
      return "Photo";
    case "reason":
      return "Note";
    default:
      return key;
  }
}

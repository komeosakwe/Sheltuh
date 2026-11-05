import type { VenueResolution } from "@/components/dashboard/VenueSuburbField";
import type { TicketTypeInput } from "@/lib/api/types";
import { MAX_REFUND_DAYS, MIN_REFUND_DAYS, isValidRefundDays, type RefundPolicy } from "@/lib/refund-policy";
import { MIN_PAID_TICKET_CENTS } from "@/lib/fees";
import { formatAud } from "@/lib/format";
import { admitsOf, groupOfLabel, MAX_GROUP_SIZE } from "@/lib/ticket-groups";
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
      // A group ticket is paid (the API refuses a free one); said by the price, the field to fix.
      if (admitsOf(t) > 1 && t.priceCents === 0 && !errors[`ticket-${i}-price`]) errors[`ticket-${i}-price`] = GROUP_NEEDS_PRICE;
      if (!Number.isInteger(t.quantityAvailable) || t.quantityAvailable < 1)
        errors[`ticket-${i}-qty`] = admitsOf(t) > 1 ? "Enter how many groups are available." : "Enter how many are available.";
      else if (t.quantityAvailable % admitsOf(t) !== 0) errors[`ticket-${i}-qty`] = GROUP_NEEDS_WHOLE_GROUPS;
    });
    if (input.refundPolicy === "days_before" && !isValidRefundDays(input.refundDays))
      errors.refundDays = `Enter a whole number of days from ${MIN_REFUND_DAYS} to ${MAX_REFUND_DAYS}.`;
  }
  return errors;
}

/** What a free group ticket is refused with (and the people-per-ticket field's reason while a free ticket can't be one). */
export const GROUP_NEEDS_PRICE = "A group ticket needs a price.";
/** The quantity is people, so a group ticket's must be a whole number of groups. */
export const GROUP_NEEDS_WHOLE_GROUPS = "A group ticket needs whole groups. Enter a whole number of groups.";

/** Why a ticket's "People per ticket" can't be changed (group tickets, docs/architecture.md), or null when it can. */
export const GROUP_REASON_SEATED = "Not available with reserved seating.";
export const GROUP_REASON_SOLD = "Can\u2019t change once tickets are sold.";
export const GROUP_REASON_FREE = "Group tickets are paid. Set a price first.";
export const GROUP_REASON_OFF = "Group tickets are switched off.";

/**
 * Why "People per ticket" is disabled on this ticket, in a few words, or null while it can be changed.
 * Seating and sales are checked before the price: a free ticket that's already a group stays editable so
 * it can go back to one person (it can't be saved free otherwise). The same while group tickets are switched
 * off: a group ticket without sales can go back to one person (the API accepts 1), but nothing becomes one.
 */
export function groupDisabledReason(
  ticket: TicketTypeInput,
  context: { enabled: boolean; reservedSeating: boolean; sold: number },
): string | null {
  if (ticket.seated === true || context.reservedSeating) return GROUP_REASON_SEATED;
  if (context.sold > 0) return GROUP_REASON_SOLD;
  // Switched off: an unsold group ticket may still go back to one person (see groupSizeOptions), nothing else.
  if (!context.enabled && admitsOf(ticket) === 1) return GROUP_REASON_OFF;
  if (ticket.priceCents === 0 && admitsOf(ticket) === 1) return GROUP_REASON_FREE;
  return null;
}

/**
 * The sizes "People per ticket" offers: 1 to 10, or while group tickets are switched off only 1 and what the
 * ticket already is (so an unsold group ticket can go back to one person, and nothing else changes).
 */
export function groupSizeOptions(ticket: TicketTypeInput, enabled: boolean): number[] {
  const all = Array.from({ length: MAX_GROUP_SIZE }, (_, i) => i + 1);
  if (enabled) return all;
  const current = admitsOf(ticket);
  return current === 1 ? [1] : [1, current];
}

/**
 * A new "Group of 4" ticket type (the editor's "Add a group ticket"): 5 groups (20 people), the organiser
 * absorbing the fee as for any new ticket. Its price is left for the organiser to set: a free one can't be saved.
 */
export const GROUP_PRESET_SIZE = 4;
const GROUP_PRESET_COUNT = 5;

export function groupTicketPreset(id: string): TicketTypeInput {
  return {
    id,
    name: groupOfLabel(GROUP_PRESET_SIZE),
    priceCents: 0,
    feePolicy: "organiser-absorbs",
    quantityAvailable: GROUP_PRESET_SIZE * GROUP_PRESET_COUNT,
    admits: GROUP_PRESET_SIZE,
  };
}

/**
 * The change to a ticket when its people per ticket becomes `admits`. Capacity is held in people, so the
 * number of people stays and goes down to whole groups (at least one, unless none were entered). An
 * empty name, or the "Group of N" this made, follows the size.
 */
export function admitsPatch(ticket: TicketTypeInput, admits: number): Partial<TicketTypeInput> {
  const next = Math.min(Math.max(Math.trunc(admits) || 1, 1), MAX_GROUP_SIZE);
  const people = Number.isInteger(ticket.quantityAvailable) ? Math.max(ticket.quantityAvailable, 0) : 0;
  const patch: Partial<TicketTypeInput> = {
    admits: next,
    quantityAvailable: people > 0 ? Math.max(Math.floor(people / next), 1) * next : 0,
  };
  const was = admitsOf(ticket);
  if (!ticket.name.trim() || (was > 1 && ticket.name === groupOfLabel(was))) patch.name = next > 1 ? groupOfLabel(next) : "";
  return patch;
}

/**
 * A ticket type as it's sent: its description trimmed, and left out when blank (the API stores none then).
 * `admits` is always sent (the API keeps the stored value when it's absent, so a single ticket sends 1).
 * `opensAfterPrevious` is always an explicit boolean (an absent one would keep the stored value, so
 * un-ticking it must send `false`), and only a general admission ticket after the first can have it.
 * `opensAfter` is read-only and never sent. `index` is the ticket's place in the list.
 */
export function cleanTicketType(ticket: TicketTypeInput, index: number): TicketTypeInput {
  const rest: TicketTypeInput = { ...ticket };
  delete rest.description;
  delete rest.opensAfter;
  const text = ticket.description?.trim();
  rest.admits = admitsOf(ticket);
  const opensAfterPrevious = index > 0 && ticket.seated !== true && ticket.opensAfterPrevious === true;
  return text ? { ...rest, description: text, opensAfterPrevious } : { ...rest, opensAfterPrevious };
}

/**
 * The API's `ticketTypes[2].opensAfterPrevious` / `.admits` / `.quantityAvailable` error keys, as this form keys them
 * by their controls (`ticket-2-lock`, `ticket-2-admits`, `ticket-2-qty`).
 */
export function formKeyedFieldErrors(fieldErrors: Record<string, string>): Record<string, string> {
  const controls: Record<string, string> = { opensAfterPrevious: "lock", admits: "admits", quantityAvailable: "qty" };
  const keyed: Record<string, string> = {};
  for (const [key, message] of Object.entries(fieldErrors)) {
    const field = /^ticketTypes\[(\d+)\]\.(opensAfterPrevious|admits|quantityAvailable)$/.exec(key);
    keyed[field ? `ticket-${field[1]}-${controls[field[2]]}` : key] = message;
  }
  return keyed;
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
    id === "add-group-ticket" ||
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
  const ticket = /^ticket-(\d+)-(name|price|qty|lock|admits)$/.exec(key);
  if (ticket) {
    const field = { name: "name", price: "price", qty: "quantity", lock: "release", admits: "people per ticket" }[ticket[2]];
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

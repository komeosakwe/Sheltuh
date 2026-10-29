import { MIN_PAID_TICKET_CENTS } from "@/lib/fees";
import { URL_DISALLOWED } from "@/lib/ticketing";
import { localToUtcIso, PLATFORM_TIME_ZONE } from "@/lib/time-zones";
import { isPlainEmailAddress, MAX_EMAIL_LENGTH } from "./email-address";
import { HttpError } from "./http";
import { EVENT_CATEGORIES, type EventCategory, type FeePolicy, type TicketTypeInput } from "./types";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}$/;

export function fail(fieldErrors: Record<string, string>): never {
  throw new HttpError(400, "Please fix the highlighted fields.", fieldErrors);
}

export function requireString(value: unknown, field: string, errors: Record<string, string>, maxLength = 2000): string {
  if (typeof value !== "string" || !value.trim()) {
    errors[field] = "This field is required.";
    return "";
  }
  if (value.length > maxLength) {
    errors[field] = `Must be ${maxLength} characters or fewer.`;
    return value.trim();
  }
  return value.trim();
}

/**
 * A single plain address (isPlainEmailAddress): no display names, comments,
 * quoted local parts or lists, so a stored value can only ever be one recipient.
 */
export function requireEmail(value: unknown, field: string, errors: Record<string, string>): string {
  const email = requireString(value, field, errors, MAX_EMAIL_LENGTH);
  if (email && !errors[field] && !isPlainEmailAddress(email)) {
    errors[field] = "Enter a valid email address.";
  }
  return email;
}

export function requireCategories(value: unknown, field: string, errors: Record<string, string>): EventCategory[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors[field] = "Choose at least one category.";
    return [];
  }
  const invalid = value.filter((v) => !EVENT_CATEGORIES.includes(v));
  if (invalid.length > 0) {
    errors[field] = "Contains an unknown category.";
    return [];
  }
  return value as EventCategory[];
}

export function requireCategory(value: unknown, field: string, errors: Record<string, string>): EventCategory {
  if (typeof value !== "string" || !EVENT_CATEGORIES.includes(value as EventCategory)) {
    errors[field] = "Choose a valid category.";
    return "live-music";
  }
  return value as EventCategory;
}

/** Longest URL accepted (matches the organisers.website_url check constraint). */
export const MAX_URL_LENGTH = 2048;

// Control, invisible-format, separator and whitespace characters (NUL
// included, which Postgres text can't store), and backslashes, which URL
// parsers read as "/" (so "https://a.example\@b.example" goes to
// a.example while reading like b.example). None belong in a URL as typed.
// Shared with the external ticket link's check (lib/ticketing.ts).

/**
 * An optional URL, trimmed. A new value must start with `https://` as typed
 * (the database checks http(s)), so the stored text is always safe to use as
 * a link's href, whatever the URL parser would have normalised. It can't
 * carry a username or password ("https://bank.example@evil.example" reads as
 * one site and goes to another), or any of URL_DISALLOWED.
 *
 * `current` is the value already stored: sent back exactly as it is, it's
 * kept even if it predates these rules (an `http://` site), so a client that
 * sends the whole record back doesn't fail on a field nobody changed.
 */
export function optionalUrl(
  value: unknown,
  field: string,
  errors: Record<string, string>,
  options: { current?: string } = {},
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    errors[field] = "Enter a valid URL.";
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (options.current !== undefined && trimmed === options.current) return trimmed;
  if (trimmed.length > MAX_URL_LENGTH) {
    errors[field] = `Must be ${MAX_URL_LENGTH} characters or fewer.`;
    return undefined;
  }
  if (/^http:\/\//i.test(trimmed)) {
    errors[field] = "Use your site's secure address, starting with https://";
    return undefined;
  }
  let url: URL;
  try {
    if (!/^https:\/\//i.test(trimmed) || URL_DISALLOWED.test(trimmed)) throw new Error("not a plain https URL");
    url = new URL(trimmed);
    if (url.protocol !== "https:") throw new Error("not https");
  } catch {
    errors[field] = "Enter a valid URL, including https://";
    return undefined;
  }
  // The authority as typed (up to the first / ? or #), as well as the parser's view.
  const authority = trimmed.slice("https://".length).split(/[/?#]/, 1)[0];
  if (authority.includes("@") || url.username || url.password) {
    errors[field] = "Enter the address without a username or password.";
    return undefined;
  }
  return trimmed;
}

/** A local time that never happens: the clocks go forward over it (daylight saving starts). */
export const DST_GAP_MESSAGE =
  "That time doesn't exist on that day: the clocks go forward an hour for daylight saving. Choose a time after the change.";

/** Whether "YYYY-MM-DD" "HH:mm" (already pattern-checked) is a real calendar date and time of day, in any zone. */
function isCalendarDateTime(date: string, time: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  if (hour > 23 || minute > 59) return false;
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day;
}

/**
 * Validates a {date, time} pair that's local to `timeZone` (an IANA zone the
 * caller has already checked) and converts it to a UTC ISO instant
 * (localToUtcIso, lib/time-zones.ts). A time in a daylight-saving gap is an
 * error (DST_GAP_MESSAGE); a time that happens twice (the clocks go back) is
 * its earlier instant. Returns undefined (and records an error) if invalid.
 */
export function requireLocalDateTime(
  value: unknown,
  field: string,
  errors: Record<string, string>,
  timeZone: string,
): string | undefined {
  if (typeof value !== "object" || value === null) {
    errors[field] = "Enter a date and time.";
    return undefined;
  }
  const { date, time } = value as { date?: unknown; time?: unknown };
  if (typeof date !== "string" || !DATE_REGEX.test(date)) {
    errors[field] = "Enter a valid date.";
    return undefined;
  }
  if (typeof time !== "string" || !TIME_REGEX.test(time)) {
    errors[field] = "Enter a valid time.";
    return undefined;
  }
  try {
    return localToUtcIso(date, time, timeZone);
  } catch {
    // A real date and time that localToUtcIso refused can only be one the zone skips.
    errors[field] = isCalendarDateTime(date, time) ? DST_GAP_MESSAGE : "Enter a valid date and time.";
    return undefined;
  }
}

/** requireLocalDateTime in Australia/Melbourne, the platform's zone. */
export function requireMelbourneDateTime(
  value: unknown,
  field: string,
  errors: Record<string, string>,
): string | undefined {
  return requireLocalDateTime(value, field, errors, PLATFORM_TIME_ZONE);
}

/** The editor's limit (components/dashboard/editor/draft.ts), enforced here too. */
export const MAX_TICKET_DESCRIPTION_LENGTH = 300;
/** Ticket types per event: an event's moderation log and records carry the whole list, so it's bounded. */
export const MAX_TICKET_TYPES = 20;

export function requireTicketTypes(value: unknown, field: string, errors: Record<string, string>): TicketTypeInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    errors[field] = "Add at least one ticket type.";
    return [];
  }
  if (value.length > MAX_TICKET_TYPES) {
    errors[field] = `Add at most ${MAX_TICKET_TYPES} ticket types.`;
    return [];
  }
  const result: TicketTypeInput[] = [];
  const seenIds = new Set<string>();
  const duplicateIds = new Set<string>();

  value.forEach((raw, i) => {
    const prefix = `${field}[${i}]`;
    if (typeof raw !== "object" || raw === null) {
      errors[prefix] = "Invalid ticket type.";
      return;
    }
    const t = raw as Record<string, unknown>;
    const name = typeof t.name === "string" ? t.name.trim() : "";
    if (!name) errors[`${prefix}.name`] = "Enter a ticket name.";
    else if (name.length > 150) errors[`${prefix}.name`] = "Must be 150 characters or fewer.";

    if (typeof t.description === "string" && t.description.trim().length > MAX_TICKET_DESCRIPTION_LENGTH) {
      errors[`${prefix}.description`] = `Must be ${MAX_TICKET_DESCRIPTION_LENGTH} characters or fewer.`;
    }

    const priceCents = t.priceCents;
    if (typeof priceCents !== "number" || !Number.isInteger(priceCents) || priceCents < 0) {
      errors[`${prefix}.priceCents`] = "Price must be a whole number of cents, 0 or more.";
    } else if (priceCents > 0 && priceCents < MIN_PAID_TICKET_CENTS) {
      errors[`${prefix}.priceCents`] = "A paid ticket must cost at least A$1.00 (or make it free).";
    }

    const feePolicy = t.feePolicy;
    if (feePolicy !== "buyer-pays" && feePolicy !== "organiser-absorbs") {
      errors[`${prefix}.feePolicy`] = "Choose who pays the booking fee.";
    }

    const quantityAvailable = t.quantityAvailable;
    if (typeof quantityAvailable !== "number" || !Number.isInteger(quantityAvailable) || quantityAvailable < 1) {
      errors[`${prefix}.quantityAvailable`] = "Enter how many tickets are available (1 or more).";
    }

    if (Object.keys(errors).some((k) => k.startsWith(prefix))) return;

    // Preserve a client-supplied id (so editing a draft keeps the same
    // ticket type stable across saves); mint a fresh one only when the
    // ticket has none yet.
    const id = typeof t.id === "string" && t.id ? t.id : crypto.randomUUID();
    if (id.length > 100) {
      errors[`${prefix}.id`] = "Invalid ticket type id.";
      return;
    }
    if (seenIds.has(id)) {
      duplicateIds.add(id);
    }
    seenIds.add(id);

    result.push({
      id,
      name,
      description: typeof t.description === "string" && t.description.trim() ? t.description.trim() : undefined,
      priceCents: priceCents as number,
      feePolicy: feePolicy as FeePolicy,
      quantityAvailable: quantityAvailable as number,
    });
  });

  if (duplicateIds.size > 0) {
    // The frontend keys per-ticket quantities and totals by this id
    // (TicketSelector.tsx) — a duplicate would silently merge two distinct
    // ticket types' quantities, so this is rejected outright rather than
    // de-duplicated.
    errors[field] = `Ticket types must have unique IDs (duplicated: ${Array.from(duplicateIds).join(", ")}).`;
    return [];
  }

  return result;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

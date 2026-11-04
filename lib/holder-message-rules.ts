import type { HolderMessageBlockReason, HolderMessageLimits, HolderMessagesState } from "@/lib/api/types";
import { containsEmailAddress, containsWebAddress } from "@/lib/contact-detail";
import { messageLength, normaliseMessage, validateMessage } from "@/lib/message-text";

/**
 * What the "Message ticket holders" form checks before a round trip, and the
 * words it uses for what the API says. The API checks everything again
 * (lib/server/handlers/holder-messages.ts, parseField) and its field error
 * is always shown: it is the source of truth. Links and email addresses are
 * found by lib/contact-detail.ts, the one definition the API uses too.
 */

/** How long after an event ends its ticket holders can still be messaged (the API's AFTER_END). */
export const MESSAGE_WINDOW_DAYS = 2;

export type HolderMessageField = "subject" | "body";

/** The text the API will store for a field (and so the preview shows). */
export function cleanedHolderText(value: string): string {
  return normaliseMessage(value);
}

/** The error for the subject or the message, or null when it can be sent. Mirrors the API's order of checks. */
export function validateHolderField(field: HolderMessageField, value: string, limits: HolderMessageLimits): string | null {
  const subject = field === "subject";
  const label = subject ? "The subject" : "The message";
  const min = subject ? limits.subjectMin : limits.bodyMin;
  const max = subject ? limits.subjectMax : limits.bodyMax;
  const basic = validateMessage(value, {
    label,
    max,
    empty: subject ? "Write a subject." : "Write a message.",
  });
  if (basic) return basic;
  const text = cleanedHolderText(value);
  if (subject && /[\r\n\t]/.test(text)) return "The subject must be on one line.";
  if (containsWebAddress(text)) return `${label} can't include links or web addresses.`;
  if (containsEmailAddress(text)) return `${label} can't include email addresses.`;
  if (messageLength(text) < min) return `${label} must be at least ${min} characters.`;
  return null;
}

/** "1 ticket holder", "12 ticket holders". */
export function ticketHolderCount(count: number): string {
  return `${count.toLocaleString("en-AU")} ticket ${count === 1 ? "holder" : "holders"}`;
}

/** Why a message can't go out now, in a few words. `external` never shows (the panel is hidden). */
export function blockedText(reason: HolderMessageBlockReason): string {
  switch (reason) {
    case "not_published":
      return "Publish the event to message its ticket holders.";
    case "external":
      return "Tickets are sold on another site.";
    case "outside_window":
      return `Messages close ${MESSAGE_WINDOW_DAYS} days after the event.`;
    case "no_recipients":
      return "Nobody holds a ticket yet.";
    case "too_many":
      return "Too many ticket holders to message at once. Contact support.";
    case "event_day_cap":
      return "This event has sent its messages for today. Try again tomorrow.";
    case "event_total_cap":
      return "This event has used all its messages.";
    case "rate_limited":
      return "You've reached today's limit. Try again tomorrow.";
  }
}

/** "2 left today · 5 left in total": what the account and the event can still send. */
export function allowanceText(remaining: HolderMessagesState["remaining"]): string {
  const today = Math.min(remaining.eventToday, remaining.organiserToday);
  const total = remaining.eventTotal;
  return `${today} left today · ${total} left in total`;
}

const SEND_BLOCK_CODES: readonly HolderMessageBlockReason[] = [
  "not_published",
  "external",
  "outside_window",
  "no_recipients",
  "too_many",
  "event_day_cap",
  "event_total_cap",
  "rate_limited",
];

/** The `code` of a refused send when it is one of the reasons a message can't go out (the state then says which). */
export function sendBlockCode(code: unknown): HolderMessageBlockReason | null {
  return SEND_BLOCK_CODES.find((known) => known === code) ?? null;
}

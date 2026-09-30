import { HttpError } from "./http";
import { isUuid } from "./pagination";
import { containsLink, tooManyMarks } from "./profile-input";
import type { ReportReason } from "./types";
import { fail } from "./validation";

/** Mirrors the messages.body check constraint (counted in code points, like char_length). */
export const MAX_MESSAGE_LENGTH = 1000;

export const REPORT_REASONS: ReportReason[] = ["harassment", "spam", "inappropriate", "impersonation", "other"];

// Control characters other than line breaks and tab, and the bidi overrides and
// isolates that can make text display in a different order from how it's
// stored (a classic spoofing trick). Zero-width joiners stay: emoji use them.
const DISALLOWED = /(?![\n\r\t])\p{Cc}|[\u202A-\u202E\u2066-\u2069\u2028\u2029]/u;
// Something visible: a letter, number, punctuation mark or symbol (emoji are symbols).
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * Cleans and checks a plain-text message: Unicode NFC, line endings
 * normalised to \n, at most one blank line in a row, trimmed. Records an
 * error under `field` and returns "" if it isn't acceptable.
 */
export function parseMessageText(
  value: unknown,
  field: string,
  errors: Record<string, string>,
  options: { allowLinks: boolean; label?: string },
): string {
  const label = options.label ?? "Messages";
  const empty = options.label ? "This can't be blank." : "Write a message.";
  if (typeof value !== "string") {
    errors[field] = empty;
    return "";
  }
  if (DISALLOWED.test(value)) {
    errors[field] = `${label} can't contain control or text-direction characters.`;
    return "";
  }
  const text = value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text || !VISIBLE.test(text)) {
    errors[field] = empty;
    return "";
  }
  if (Array.from(text).length > MAX_MESSAGE_LENGTH) {
    errors[field] = `Must be ${MAX_MESSAGE_LENGTH} characters or fewer.`;
    return "";
  }
  if (tooManyMarks(text)) {
    errors[field] = `${label} can't stack accents or other marks on one character.`;
    return "";
  }
  if (!options.allowLinks && containsLink(text)) {
    errors[field] = "A first message can't include links. You can share them once they reply.";
    return "";
  }
  return text;
}

/** An opaque uuid from the request body. Missing is a 400; malformed can't exist, so it's a 404. */
function optionalId(value: unknown, field: string, errors: Record<string, string>, notFound: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    errors[field] = "Invalid id.";
    return undefined;
  }
  if (!isUuid(value)) throw new HttpError(404, notFound);
  return value;
}

const MESSAGE_ID = /^[1-9][0-9]{0,17}$/;

/** A messageId (a positive integer as a string), or undefined if absent. 400 if malformed. */
export function parseMessageId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !MESSAGE_ID.test(value)) fail({ [field]: "Invalid message id." });
  return value;
}

export const MEMBER_UNAVAILABLE = "This member isn't available to message.";

/** POST /api/conversations body. */
export function parseStartConversation(body: Record<string, unknown>): { attendeeId: string; body: string } {
  const errors: Record<string, string> = {};
  if (body.attendeeId === undefined || body.attendeeId === null) errors.attendeeId = "Choose who to message.";
  const attendeeId = optionalId(body.attendeeId, "attendeeId", errors, MEMBER_UNAVAILABLE);
  const text = parseMessageText(body.body, "body", errors, { allowLinks: false });
  if (Object.keys(errors).length > 0) fail(errors);
  return { attendeeId: attendeeId as string, body: text };
}

/** POST /api/conversations/{id}/messages body. */
export function parseSendMessage(body: Record<string, unknown>): { body: string } {
  const errors: Record<string, string> = {};
  const text = parseMessageText(body.body, "body", errors, { allowLinks: true });
  if (Object.keys(errors).length > 0) fail(errors);
  return { body: text };
}

/** Exactly one of conversationId / attendeeId (POST /api/blocks, POST /api/reports). */
export function parseTarget(
  body: Record<string, unknown>,
  notFound: string,
  errors: Record<string, string>,
): { conversationId?: string; attendeeId?: string } {
  const conversationId = optionalId(body.conversationId, "conversationId", errors, notFound);
  const attendeeId = optionalId(body.attendeeId, "attendeeId", errors, notFound);
  const given = [body.conversationId, body.attendeeId].filter((v) => v !== undefined && v !== null).length;
  if (given !== 1) errors.conversationId = "Give exactly one of conversationId or attendeeId.";
  return { conversationId, attendeeId };
}

/** POST /api/reports body. */
export function parseReport(body: Record<string, unknown>, notFound: string) {
  const errors: Record<string, string> = {};
  const target = parseTarget(body, notFound, errors);
  const reason = body.reason;
  if (typeof reason !== "string" || !REPORT_REASONS.includes(reason as ReportReason)) {
    errors.reason = "Choose a reason.";
  }
  let messageId: string | undefined;
  try {
    messageId = parseMessageId(body.messageId, "messageId");
  } catch {
    errors.messageId = "Invalid message id.";
  }
  if (messageId && !target.conversationId && !errors.conversationId) {
    errors.messageId = "A message can only be reported with its conversation.";
  }
  let details: string | undefined;
  if (body.details !== undefined && body.details !== null && body.details !== "") {
    details = parseMessageText(body.details, "details", errors, { allowLinks: true, label: "Details" }) || undefined;
  }
  if (Object.keys(errors).length > 0) fail(errors);
  return { ...target, messageId, reason: reason as ReportReason, details };
}

/** POST /api/admin/reports/{id}/resolve body. */
export function parseResolveReport(body: Record<string, unknown>): { action: "dismiss" | "suspend"; note?: string } {
  const errors: Record<string, string> = {};
  const action = body.action;
  if (action !== "dismiss" && action !== "suspend") errors.action = "Choose dismiss or suspend.";
  let note: string | undefined;
  if (body.note !== undefined && body.note !== null && body.note !== "") {
    note = parseMessageText(body.note, "note", errors, { allowLinks: true, label: "Notes" }) || undefined;
  }
  if (Object.keys(errors).length > 0) fail(errors);
  return { action: action as "dismiss" | "suspend", note };
}

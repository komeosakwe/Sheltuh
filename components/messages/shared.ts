import { ApiError } from "@/lib/api/client";
import type { ReportReason } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { SESSION_EXPIRED_MESSAGE } from "@/components/whos-going/shared";

/** How often an open conversation checks for new messages (while visible and focused). */
export const THREAD_POLL_MS = 10_000;

export const inlineLinkClass = "underline underline-offset-4 hover:decoration-2";
export const tallInlineLinkClass = `inline-flex min-h-11 items-center ${inlineLinkClass}`;

export function threadHref(conversationId: string) {
  return `/messages/${encodeURIComponent(conversationId)}`;
}

/**
 * The one message for "this person or conversation isn't there for you".
 * Blocked, declined, suspended and deleted all look the same (the API keeps
 * them identical, and so does the UI).
 */
export const UNAVAILABLE_PERSON = "This person can’t be messaged.";

export const REPORT_REASONS: { value: ReportReason; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "spam", label: "Spam or a scam" },
  { value: "inappropriate", label: "Sexual or offensive content" },
  { value: "impersonation", label: "Pretending to be someone else" },
  { value: "other", label: "Something else" },
];

export function reportReasonLabel(reason: ReportReason): string {
  return REPORT_REASONS.find((r) => r.value === reason)?.label ?? reason;
}

/**
 * What went wrong with a messaging action, sorted into what the UI does
 * about it. `field`: shown on the message field. `unavailable`: the
 * conversation or person has gone (404). `conflict` (409): there's already
 * a conversation (a first message), or a reply is still awaited (sending).
 * Everything else is a `message`.
 */
export type MessagingError =
  | { kind: "field"; field: string; message: string }
  | { kind: "unavailable" }
  | { kind: "conflict"; message: string }
  | { kind: "message"; message: string };

const GENERIC = "Couldn’t send that. Try again.";

/** Maps an error from startConversation / sendMessage / reportMember / blockMember. */
export function messagingError(
  err: unknown,
  { rateLimited, fallback = GENERIC }: { rateLimited: string; fallback?: string },
): MessagingError {
  if (err instanceof SessionExpiredError) return { kind: "message", message: SESSION_EXPIRED_MESSAGE };
  if (!(err instanceof ApiError)) return { kind: "message", message: fallback };
  const [field, fieldMessage] = Object.entries(err.fieldErrors ?? {})[0] ?? [];
  switch (err.status) {
    case 0:
      return { kind: "message", message: err.message };
    case 400:
      return field && fieldMessage ? { kind: "field", field, message: fieldMessage } : { kind: "message", message: err.message };
    case 403:
      // "Verify your email address first." / not going to the same event /
      // "Your profile can't send messages right now." (suspended): each is
      // about the caller, and something they can act on.
      return { kind: "message", message: err.message };
    case 404:
      return { kind: "unavailable" };
    case 409:
      return { kind: "conflict", message: err.message };
    case 429:
      return { kind: "message", message: rateLimited };
    default:
      return { kind: "message", message: fallback };
  }
}

/** A load failure's message: the caller's own 403 is explained; anything else is generic. */
export function loadErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && (err.status === 403 || err.status === 0)) return err.message;
  return fallback;
}

import { ApiError } from "@/lib/api/client";
import type { InviteKind } from "@/lib/api/types";
import { SessionExpiredError } from "@/lib/auth/session-token";
import { SUPPORT_EMAIL } from "@/lib/contact";
import { INVITE_LINK_DAYS } from "@/lib/invites";

/**
 * Why the invite page can't go on (lib/api/invites.ts's errors, in our own
 * words): its heading, what it means, and whether trying again might work.
 * `used` also offers to sign in (the invite is already someone's account).
 * `contactSubject`: the screen offers to email the Sheltüh team, with this
 * subject. `kind`: the invite's, when it's known (where a signed-in "used"
 * sends them).
 */
export interface InviteProblem {
  reason: "invalid" | "expired" | "revoked" | "used" | "not-yours" | "failed";
  title: string;
  message: string;
  retry: boolean;
  contactSubject?: string;
  kind?: InviteKind;
}

/** A link to email the Sheltüh team, with the subject filled in. */
export function supportMailto(subject: string): string {
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}

/** What the invite pages' email links say: the address itself, so it can be copied without a mail app. */
export const SUPPORT_LINK_LABEL = `Email ${SUPPORT_EMAIL}`;

export const NEW_INVITE_SUBJECT = "New invite link";

export const INVALID_LINK: InviteProblem = {
  reason: "invalid",
  title: "This invite link isn’t valid",
  message:
    "Open it straight from your email, making sure the whole link is used. If it still doesn’t work, ask the Sheltüh team to send a new invite.",
  retry: false,
  contactSubject: NEW_INVITE_SUBJECT,
};

const GONE: Record<"expired" | "revoked" | "used", InviteProblem> = {
  expired: {
    reason: "expired",
    title: "This invite has expired",
    message: `Invite links work for ${INVITE_LINK_DAYS} days. Ask the Sheltüh team to send you a new one.`,
    retry: false,
    contactSubject: NEW_INVITE_SUBJECT,
  },
  revoked: {
    reason: "revoked",
    title: "This invite has been withdrawn",
    message: "It can’t be used any more. Contact the Sheltüh team if you think that’s a mistake.",
    retry: false,
    contactSubject: NEW_INVITE_SUBJECT,
  },
  used: {
    reason: "used",
    title: "This invite has already been used",
    message: "Its account is set up. Sign in to continue.",
    retry: false,
  },
};

/** A 410's `code` (expired, revoked or used), if the error is one. */
export function goneReason(err: unknown): "expired" | "revoked" | "used" | null {
  if (!(err instanceof ApiError) || err.status !== 410) return null;
  const code = err.body?.code;
  return code === "expired" || code === "revoked" || code === "used" ? code : "expired";
}

/** The `code` an ApiError's body carries ("has_account", "unavailable"), if any. */
export function apiErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = err.body?.code;
  return typeof code === "string" ? code : null;
}

/**
 * Why accepting failed, said beside the button: the API's words for a
 * refusal (4xx), an expired session's, and otherwise (no connection, a
 * server fault) our own.
 */
export function acceptErrorText(err: unknown): string {
  if (err instanceof ApiError && err.status >= 400 && err.status < 500) return err.message;
  if (err instanceof SessionExpiredError) return "Your session has expired. Sign in again, then open this page to accept.";
  return "We couldn’t accept your invite just now. Try again in a moment.";
}

/**
 * The usual reading of an invite request's error: 400/404 an invalid link,
 * 410 by its code, anything else (no connection, a server fault, too many
 * tries) worth saying in the API's words and, unless refused, trying again.
 */
export function inviteProblem(err: unknown, what: string): InviteProblem {
  const gone = goneReason(err);
  if (gone) return GONE[gone];
  if (err instanceof ApiError) {
    if (err.status === 400 || err.status === 404) return INVALID_LINK;
    if (err.status === 429) return { reason: "failed", title: "Too many tries", message: err.message, retry: false };
    if (err.status === 0 || (err.status >= 400 && err.status < 500)) {
      return { reason: "failed", title: "Something went wrong", message: err.message, retry: true };
    }
  }
  return {
    reason: "failed",
    title: "Something went wrong",
    message: `We couldn’t ${what} just now. Try again in a moment.`,
    retry: true,
  };
}

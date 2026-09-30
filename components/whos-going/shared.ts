import { ApiError } from "@/lib/api/client";
import { SessionExpiredError } from "@/lib/auth/session-token";

/** Pills are 48px (btn-lg) below lg and back to the md size (44px min) from lg. */
export const pillClass = "min-h-11 w-full sm:w-auto lg:px-6 lg:py-2.5 lg:text-xs/4.5";

export const GENERIC_MUTATION_ERROR = "Couldn't update that. Try again.";

/** Shown with a "Sign in" link by ActionErrorNotice. */
export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again to continue.";

/**
 * What to tell someone when a Who's Going change fails. The API's own
 * message is used where it explains something they can act on (not
 * eligible, verify your email, sign in again); anything else is generic.
 */
export function mutationErrorMessage(err: unknown): string {
  if (err instanceof SessionExpiredError) return SESSION_EXPIRED_MESSAGE;
  if (err instanceof ApiError && [403, 404, 409].includes(err.status)) return err.message;
  return GENERIC_MUTATION_ERROR;
}
